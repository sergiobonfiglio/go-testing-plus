import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { processGoTestJsonLines, parseGoTestOutcomeLines, testRunOutcome } from './testOutputParser';
const { spawn } = require('child_process');


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
        await Promise.all(
            testItems.map(item => this.runTestItem(testRun, item, token))
        );

        testRun.end();
    }


    private async runTestItem(
        testRun: vscode.TestRun,
        item: vscode.TestItem,
        token: vscode.CancellationToken
    ): Promise<void> {
        if (token.isCancellationRequested) {
            return;
        }
        testRun.enqueued(item);

        // also enqueue children as they will be executed as part of the parent test
        for (const [, child] of item.children) {
            testRun.enqueued(child);
        }

        return goTestRun(item, testRun);
    }



    async debugHandler(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken): Promise<void> {

        const testRun = this.ctrl.createTestRun(request);
        for (const test of request.include ?? []) {
            if (!test.uri) {
                testRun.errored(test, new vscode.TestMessage('Cannot debug test: no URI associated with test item'));
                continue;
            }

            // enqueue test and its children
            testRun.enqueued(test);
            for (const [, child] of test.children) {
                testRun.enqueued(child);
            }

            const testName = buildGoTestName(test);
            // testName would be empty if the item is the file itself, so use '.' to run all tests in the file.
            const pattern = testName ? `^${escapeRegex(testName)}$` : '.';

            const debugConfig = {
                type: 'go',
                name: 'Debug Single Test',
                request: 'launch',
                mode: 'test',
                program: test.uri.fsPath,
                args: ['-test.v', '-test.run', pattern]
            };

            // setup debug callbacks before starting the debug session
            setupDebugListerners(
                () => testRun.started(test),
                (out: string) => parseGoTestOutcomeLines(test, testRun, out),
                () => testRun.end()
            );

            // start debug session
            const debugStarted = await vscode.debug.startDebugging(undefined, debugConfig);
            if (!debugStarted) {
                testRun.errored(test, new vscode.TestMessage('Debug session failed'));
                return;
            }

        }
    }
}

function setupDebugListerners(
    onStart: (_: vscode.DebugSession) => void,
    onOutput: (out: string) => void,
    onTerminate: (_: vscode.DebugSession) => void,
) {
    const debugAdapter = vscode.debug.registerDebugAdapterTrackerFactory('go', {
        createDebugAdapterTracker(s) {
            if (s.type !== 'go') {
                return;
            };
            return {
                onDidSendMessage(msg: { type: string; event: string; body: { category: string; output: string } }) {
                    if (msg.type !== 'event' || msg.event !== 'output') {
                        return;
                    }

                    if (msg.body.category === 'stdout' || msg.body.category === 'stderr') {
                        onOutput(msg.body.output);
                    }
                },
            };
        },
    });

    const debugStartListener = vscode.debug.onDidStartDebugSession(session => {
        onStart(session);
    });

    const debugStopListener = vscode.debug.onDidTerminateDebugSession(((session: vscode.DebugSession) => {
        debugStartListener.dispose();
        debugStopListener.dispose();
        debugAdapter.dispose();

        onTerminate(session);
    }));
}


async function goTestRun(item: vscode.TestItem, testRun: vscode.TestRun): Promise<void> {
    // Guard: we need a file URI to know where to run `go test` from
    if (!item.uri) {
        testRun.errored(item, new vscode.TestMessage('No URI associated with test item'));
        return;
    }

    // Build the full test name (TestFunc[/SubTest[/NestedSubTest...]] )
    const testName = buildGoTestName(item);

    const cwd = path.dirname(item.uri.fsPath);

    // testName would be empty if the item is the file itself, so use '.' to run all tests in the file.
    const pattern = testName ? `^${escapeRegex(testName)}$` : '.';

    const runArgs = ['test', '-json', '-run', pattern];

    testRun.appendOutput(`Running go test -json -run '${pattern}' [cwd: ${cwd}]\r\n`, undefined, item);

    const child = spawn('go', runArgs, {
        cwd,
        env: { ...process.env, GO111MODULE: process.env.GO111MODULE || 'on' },
    });

    child.stdout.on('data', (data: Buffer) => {
        const output = data.toString();
        testRun.appendOutput(output, undefined, item); // Stream output to test run
        processGoTestJsonLines(item, testRun, output);
    });

    child.stderr.on('data', (data: Buffer) => {
        const errorOutput: string = data.toString();
        testRun.appendOutput(errorOutput, undefined, item); // Stream error output to test run
        processGoTestJsonLines(item, testRun, errorOutput);
    });

    await new Promise<void>((resolve) => {
        child.on('close', (code: number | null) => {
            resolve();
        });
    });
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, r => `\\${r}`);
}

export function buildGoTestName(
    item: vscode.TestItem,
    stripDuplicateSuffix: boolean = true
): string {
    // Walk up until we reach the file (label ends with _test.go) collecting labels.
    const parts: string[] = [];
    let current: vscode.TestItem | undefined = item;
    while (current) {
        if (current.label.endsWith('_test.go')) {
            break; // stop at file level
        }

        let label = current.label;
        // for duplicated test names we append a count suffix (e.g. #1) to distinguish them
        // so we need to strip that suffix when building the full test name for execution
        if (stripDuplicateSuffix) {
            const nameMatch = label.match(/^(.*?)(#\d+)$/);
            if (nameMatch) {
                label = nameMatch[1];
            }
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













