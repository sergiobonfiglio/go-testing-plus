import path from "path";
import { Location, Position, TestItem, TestMessage, TestRun, Uri } from "vscode";
import { buildGoTestName } from "./testRunner";
import { get } from "http";

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

export function parseGoTestJsonLines(
    test: TestItem,
    run: TestRun,
    output: string
): testRunOutcome {

    let outcome: testRunOutcome | undefined = undefined;

    // const collectedOutputs: string[] = [];

    const outputByTest: Map<TestItem, string[]> = new Map();

    splitLines(output).forEach(e => {

        if (!e.Test) {
            // ignore package-level events for now
            return;
        }

        const referencedTest = getTestByJsonName(test, e.Test);
        if (!referencedTest) {
            //TODO: if the test is not found, it could be a sub-test
            // with a dynamic name that we're currently not able to resolve
            // statically. We could use the output to add it to the controller
            // now for future runs.
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
                outcome = 'passed';
                break;

            case 'fail': {
                const messages = parseOutput(referencedTest, outputByTest.get(referencedTest) || []);
                run.failed(referencedTest, messages, (e.Elapsed ?? 0) * 1000);
                outcome = 'failed';
                break;
            }

            case 'skip':
                run.skipped(referencedTest);
                outcome = 'skipped';
                break;

            case 'output':
                if (/^(=== RUN|\s*--- (FAIL|PASS|SKIP): )/.test(e.Output ?? '')) {
                    break;
                }
                if (e.Output) {
                    run.appendOutput(e.Output + '\r\n', undefined, referencedTest);
                }
        }
    });

    return outcome || 'errored';
}


function getTestByJsonName(test: TestItem, testJsonName: string): TestItem | undefined {

    let current: TestItem | undefined = test;
    let currentJsonName = getJsonName(current);
    while (currentJsonName !== testJsonName && current.parent) {
        current = current.parent;
        currentJsonName = getJsonName(current);
    }

    if (testJsonName === currentJsonName) {
        return current;
    }

    return undefined;
}

function getJsonName(test: TestItem): string {
    const fullTestName = buildGoTestName(test);
    return fullTestName.replaceAll(' ', '_');
}

function splitLines(output: string): GoTestOutput[] {
    return output.
        split(/\r?\n/).
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
        const m = line.match(/^.*\s+(?<file>\S+\.go):(?<line>\d+): (?<message>.*\n)$/);
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



// function consumeGoTestEvent(
//     item: TestItem,
//     run: TestRun,
//     // tests: Record<string, TestItem>,
//     // record: Map<string, string[]>,
//     // complete: Set<TestItem>,
//     // concat: boolean,
//     e: GoTestOutput
// ) {
//     const test = e.Test && resolveTestName(tests, e.Test);
//     if (!test) {
//         return;
//     }

//     switch (e.Action) {
//         case 'cont':
//         case 'pause':
//             // ignore
//             break;

//         case 'run':
//             run.started(test);
//             break;

//         case 'pass':
//             // TODO(firelizzard18): add messages on pass, once that capability
//             // is added.
//             complete.add(test);
//             run.passed(test, (e.Elapsed ?? 0) * 1000);
//             break;

//         case 'fail': {
//             complete.add(test);
//             const messages = parseOutput(test, record.get(test.id) || []);

//             if (!concat) {
//                 run.failed(test, messages, (e.Elapsed ?? 0) * 1000);
//                 break;
//             }

//             const merged = new Map<string, TestMessage>();
//             for (const { message, location } of messages) {
//                 const loc = `${location?.uri}:${location?.range.start.line}`;
//                 if (merged.has(loc)) {
//                     merged.get(loc)!.message += '' + message;
//                 } else {
//                     merged.set(loc, { message, location });
//                 }
//             }

//             run.failed(test, Array.from(merged.values()), (e.Elapsed ?? 0) * 1000);
//             break;
//         }

//         case 'skip':
//             complete.add(test);
//             run.skipped(test);
//             break;

//         case 'output':
//             if (/^(=== RUN|\s*--- (FAIL|PASS): )/.test(e.Output ?? '')) {
//                 break;
//             }

//             if (record.has(test.id)) { record.get(test.id)!.push(e.Output ?? ''); }
//             else { record.set(test.id, [e.Output ?? '']); }
//             break;
//     }
// }