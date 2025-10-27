import path from "path";
import { Location, Position, TestItem, TestMessage, TestRun, Uri } from "vscode";
import { buildGoTestName } from "./testRunner";

/**
 * go test -json output format.
 * which is a subset of https://golang.org/cmd/test2json/#hdr-Output_Format
 * and includes only the fields that we are using.
 */
export interface GoTestOutput {
    Action: string;
    Output?: string;
    Package?: string;
    Test?: string;
    Elapsed?: number; // seconds
}

export type testRunOutcome = 'passed' | 'failed' | 'skipped' | 'errored';

export function processGoTestJsonLines(
    test: TestItem,
    run: TestRun,
    output: string
) {

    const outputByTest: Map<TestItem, string[]> = new Map();

    splitLines(output).forEach(e => {
        if (!e.Test) {
            // ignore package-level events for now
            return;
        }

        const referencedTest = getTestByEscapedName(test, e.Test);
        if (!referencedTest) {
            //TODO: if the test is not found, it could be a sub-test
            // with a dynamic name that we're currently not able to resolve
            // statically. We could use the output to add it to the controller
            // now for future runs.
            console.warn(`could not find test item for test name: ${e.Test}`);
            return;
        }

        if (e.Output) {
            outputByTest.set(
                referencedTest,
                (outputByTest.get(referencedTest) || []).concat([e.Output])
            );
        }

        switch (e.Action) {
            case 'cont':
            case 'pause':
                // ignore
                break;

            case 'run':
                run.started(referencedTest);
                break;

            case 'pass':
                run.passed(referencedTest, (e.Elapsed ?? 0) * 1000);
                break;

            case 'fail': {
                const messages = parseOutput(referencedTest, outputByTest.get(referencedTest) || []);
                run.failed(referencedTest, messages, (e.Elapsed ?? 0) * 1000);
                break;
            }

            case 'skip':
                run.skipped(referencedTest);
                break;

            case 'output':
                if (e.Output) {
                    run.appendOutput(e.Output + "\r", undefined, referencedTest);
                }
        }
    });

}


const testByEscapedNameCache = new Map<string, TestItem | undefined>();

function getTestByEscapedName(test: TestItem, targetEscapedName: string): TestItem | undefined {
    const cacheKey = `${test.id}:${targetEscapedName}`;

    if (testByEscapedNameCache.has(cacheKey)) {
        return testByEscapedNameCache.get(cacheKey);
    }

    // Traverse up to find the matching test item by comparing JSON names
    let current: TestItem | undefined = test;
    let currentJsonName = getJsonName(test);
    while (currentJsonName !== targetEscapedName && current.parent) {
        current = current.parent;
        currentJsonName = getJsonName(current);
    }

    let result: TestItem | undefined;
    if (targetEscapedName === currentJsonName) {
        result = current;
    } else {
        result = findChildTestByEscapedName(test, targetEscapedName);
    }

    testByEscapedNameCache.set(cacheKey, result);
    return result;
}

function findChildTestByEscapedName(test: TestItem, targetEscapedName: string): TestItem | undefined {
    for (const [_, child] of test.children) {
        const childJsonName = getJsonName(child);
        if (childJsonName === targetEscapedName) {
            return child;
        }
        if (child.children.size > 0) {
            if (findChildTestByEscapedName(child, targetEscapedName)) {
                return findChildTestByEscapedName(child, targetEscapedName);
            }
        }
    }
    return undefined;
}

function getJsonName(test: TestItem): string {
    // do not strip duplicate suffixes here
    const fullTestName = buildGoTestName(test, false);
    return fullTestName.replaceAll(' ', '_');
}

function splitLines(output: string): GoTestOutput[] {
    return output.
        split(/\r?\n/).
        filter(Boolean).
        map(line => {
            try {
                return <GoTestOutput>JSON.parse(line);
            } catch (e) {
                console.warn(`failed to parse JSON: ${e}: ${line}`);
            }
        }).
        filter(line => line !== undefined);
}



function parseOutput(test: TestItem, output: string[]): TestMessage[] {
    const messages: TestMessage[] = [];

    let current: Location | undefined;
    if (!test.uri) { return messages; }
    const dir = Uri.joinPath(test.uri, '..').fsPath;


    for (const line of output) {
        // ^(?:.*\s+|\s*) - non-greedy match of any chars followed by a space or, a space.
        // (?<file>\S+\.go):(?<line>\d+):  - gofile:line: followed by a space.
        // (?<message>.\n)$ - all remaining message up to $.
        const m = line.match(/^.*\s+(?<file>\S+\.go):(?<line>\d+): (?<message>.*\n?)$/);
        if (m?.groups) {
            const file =
                m.groups.file && path.isAbsolute(m.groups.file)
                    ? Uri.file(m.groups.file)
                    : Uri.file(path.join(dir, m.groups.file));
            const ln = Number(m.groups.line) - 1; // VSCode uses 0-based line numbering (internally)
            current = new Location(file, new Position(ln, 0));
            messages.push({ message: m.groups.message, location: current });
        } else if (current) {
            messages.push({ message: line, location: current });
        }
    }

    return messages;
}


export function parseGoTestOutcomeLines(
    test: TestItem,
    run: TestRun,
    output: string,
) {

    for (const line of output.split(/\r?\n/)) {

        const runMatch = line.match(/=== RUN\s+(?<testName>.+)/);
        if (runMatch?.groups?.testName) {
            const testName = runMatch?.groups?.testName;
            const referencedTest = getTestByEscapedName(test, testName);
            if (!referencedTest) {
                continue;
            }
            run.started(referencedTest);
        }

        const resultMatch = line.match(/--- (?<outcome>PASS|FAIL|SKIP):\s+(?<testName>.+)\s+\((?<elapsed>[0-9\.]+)s\)/);
        if (resultMatch?.groups?.testName && resultMatch?.groups?.outcome) {
            const testName = resultMatch?.groups?.testName;
            const referencedTest = getTestByEscapedName(test, testName);
            if (!referencedTest) {
                continue;
            }
            const elapsed = Number(resultMatch?.groups?.elapsed);
            switch (resultMatch?.groups?.outcome) {
                case 'PASS':
                    run.passed(referencedTest, elapsed * 1000);
                    break;
                case 'FAIL':
                    run.failed(referencedTest, [], elapsed * 1000);
                    break;
                case 'SKIP':
                    run.skipped(referencedTest);
                    break;
            }
        }
    }
    return;
}