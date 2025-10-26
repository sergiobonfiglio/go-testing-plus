import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseGoTestJsonLines, testRunOutcome } from './testOutputParser';


type testRunResult = {
    outcome: testRunOutcome,
    output?: string
}

export class GoTestRunner {

    private readonly ctrl: vscode.TestController;
    constructor(ctrl: vscode.TestController) {
        this.ctrl = ctrl;
    }


    async runHandler(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken): Promise<void> {

        //create test run to report progress
        const testRun = this.ctrl.createTestRun(request);

        // fallback to all tests if none specified in the request
        let testItems: readonly vscode.TestItem[] = request.include ||
            Array.from(this.ctrl.items).map(x => x[1]);

        //filter out excluded tests
        if (request.exclude) {
            const excludeSet = new Set(request.exclude);
            testItems = testItems.filter(item => !excludeSet.has(item));
        }

        //execute tests
        for (const item of testItems) {
            await this.runTestItem(testRun, item, token);
        }

        testRun.end();
    }


    private async runTestItem(
        testRun: vscode.TestRun,
        item: vscode.TestItem,
        token: vscode.CancellationToken,
        depth: number = 0
    ): Promise<testRunResult> {
        if (token.isCancellationRequested) {
            return { outcome: 'skipped', output: 'Test run cancelled' };
        }
        testRun.enqueued(item);

        let itemOutcome: testRunResult;
        try {
            itemOutcome = await goTestRun(item, testRun);
        } catch (err: any) {
            itemOutcome = { outcome: 'errored', output: (err as Error).message };
        }

        // run sub-tests items if any
        const childrenOutcome = await Promise.all(
            Array.from(item.children).
                map(child => this.runTestItem(testRun, child[1], token, depth + 1))
        );

        const failedChild = childrenOutcome.find(x => x.outcome === 'failed');
        if (failedChild) {
            testRun.failed(item, new vscode.TestMessage(`Test failed: nested test failed with output: ${failedChild.output}`));
            return { outcome: 'failed', output: failedChild.output };
        }
        return { outcome: 'passed' };
    }
}


async function goTestRun(item: vscode.TestItem, testRun: vscode.TestRun): Promise<testRunResult> {
    // Guard: we need a file URI to know where to run `go test` from
    if (!item.uri) {
        return { outcome: 'skipped', output: 'No URI associated with test item' };
    }

    // Build the full test name (TestFunc[/SubTest[/NestedSubTest...]] )
    const testName = buildGoTestName(item);

    const cwd = path.dirname(item.uri.fsPath);

    // testName would be empty if the item is the file itself, so use '.' to run all tests in the file.
    const pattern = testName ? `^${escapeRegex(testName)}$` : '.';

    const runArgs = ['test', '-json', '-run', pattern];

    testRun.appendOutput(`Running go test -json -run '${pattern}' [cwd: ${cwd}]\r\n`, undefined, item);
    const execFileAsync = promisify(execFile);

    let combinedOutput: string;
    try {
        const { stdout, stderr } = await execFileAsync('go', runArgs, {
            cwd,
            env: { ...process.env, GO111MODULE: process.env.GO111MODULE || 'on' },
            maxBuffer: 10 * 1024 * 1024 // 10MB just in case
        });

        combinedOutput = combineOutput(stdout, stderr);
        // const outcome = parseGoTestJsonLines(item, testRun, combined);

        // return { outcome, output: combined };
    } catch (err: any) {
        const stdout = err.stdout ?? '';
        const stderr = err.stderr ?? '';
        combinedOutput = combineOutput(stdout, stderr, err.message);
    }

    const outcome = parseGoTestJsonLines(item, testRun, combinedOutput);
    return { outcome: 'failed', output: combinedOutput };
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, r => `\\${r}`);
}

export function buildGoTestName(item: vscode.TestItem): string {
    // Walk up until we reach the file (label ends with _test.go) collecting labels.
    const parts: string[] = [];
    let current: vscode.TestItem | undefined = item;
    while (current) {
        if (current.label.endsWith('_test.go')) {
            break; // stop at file level
        }

        // for duplicated test names we append a count suffix (e.g. #1) to distinguish them
        // so we need to strip that suffix when building the full test name for execution
        let label = current.label;
        const nameMatch = label.match(/^(.*?)(#\d+)$/);
        if (nameMatch) {
            label = nameMatch[1];
        }

        parts.push(label);

        current = current.parent as vscode.TestItem | undefined;
    }
    return parts.reverse().join('/');
}

function combineOutput(...chunks: (string | undefined)[]): string {
    return chunks
        // split into lines so that we can normalize line endings to \r\n
        .flatMap(l => l?.split('\n'))
        .map(l => l?.replaceAll('\r', ''))
        .filter(Boolean)
        .join('\r\n').trim();
}


function parseGoTestOutcomeLine(output: string): testRunOutcome {
    // Look for standard go test summary lines for the specific test.
    // If we see "FAIL" before "PASS" treat as failed.

    if (/\bno tests to run\b/i.test(output)) {
        return 'skipped';
    }

    if (/\[build failed\]/i.test(output)) {
        return 'errored';
    }

    if (/\bSKIP\b/.test(output)) {
        return 'skipped';
    }

    if (/\bFAIL\b/.test(output) && !/\bPASS\b/.test(output)) {
        return 'failed';
    }
    if (/\bFAIL\b/.test(output) && /\bPASS\b/.test(output)) {
        // Mixed output: locate last summary line
        const lines = output.split(/\r?\n/);
        for (let i = lines.length - 1; i >= 0; i--) {
            const l = lines[i];
            if (/^FAIL\b/.test(l)) {
                return 'failed';
            }
            if (/^ok\b|^PASS\b/.test(l)) {
                return 'passed';
            }
        }
        return 'failed';
    }
    if (/\bok\b|\bPASS\b/.test(output)) {
        return 'passed';
    }
    return 'failed';
}










