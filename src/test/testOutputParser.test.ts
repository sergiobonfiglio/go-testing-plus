import { processGoTestJsonLines, parseGoTestOutcomeLines, GoTestOutput } from '../testOutputParser';
import * as vscode from 'vscode';
import { TestRunContext } from '../testRunner';

let expect: Chai.ExpectStatic;

describe('testOutputParser', () => {
    before(async () => {
        expect = (await import('chai')).expect;
    });
    let mockTestItem: vscode.TestItem;
    let mockController: vscode.TestController;
    let mockTestRun: any;
    let runCtx: TestRunContext;
    let startedTests: vscode.TestItem[];
    let passedTests: Array<{ test: vscode.TestItem; duration: number }>;
    let failedTests: Array<{ test: vscode.TestItem; messages: vscode.TestMessage[]; duration: number }>;
    let skippedTests: vscode.TestItem[];
    let outputLines: Array<{ message: string; test?: vscode.TestItem }>;

    beforeEach(() => {
        // Reset tracking arrays
        startedTests = [];
        passedTests = [];
        failedTests = [];
        skippedTests = [];
        outputLines = [];

        // Create mock controller
        mockController = {
            items: new Map(),
            createTestItem: (id: string, label: string, uri?: vscode.Uri) => {
                const childrenMap = new Map<string, vscode.TestItem>();
                const item: any = {
                    id,
                    label,
                    uri,
                    children: {
                        get size() { return childrenMap.size; },
                        forEach: (callback: any) => childrenMap.forEach(callback),
                        get: (id: string) => childrenMap.get(id),
                        add: (item: any) => {
                            childrenMap.set(item.id, item);
                        },
                        delete: (id: string) => childrenMap.delete(id),
                        [Symbol.iterator]: () => childrenMap.entries(),
                    },
                    // Use a writable property for parent in tests
                    _parent: undefined,
                    get parent() { return this._parent; },
                    set parent(value) { this._parent = value; },
                    canResolveChildren: false,
                };
                return item;
            },
        } as any;

        // Create mock test item
        mockTestItem = mockController.createTestItem(
            'test-file',
            'example_test.go',
            vscode.Uri.file('/test/example_test.go')
        );

        // Create mock test run
        mockTestRun = {
            started: (test: vscode.TestItem) => {
                startedTests.push(test);
            },
            passed: (test: vscode.TestItem, duration?: number) => {
                passedTests.push({ test, duration: duration || 0 });
            },
            failed: (test: vscode.TestItem, messages: vscode.TestMessage | readonly vscode.TestMessage[], duration?: number) => {
                const messageArray = Array.isArray(messages) ? messages : [messages];
                failedTests.push({ test, messages: messageArray, duration: duration || 0 });
            },
            skipped: (test: vscode.TestItem) => {
                skippedTests.push(test);
            },
            appendOutput: (message: string, location?: vscode.Location, test?: vscode.TestItem) => {
                outputLines.push({ message, test });
            },
        };

        runCtx = {
            testRun: mockTestRun,
            controller: mockController,
            testItemByEscapedName: new Map(),
        };
    });

    describe('processGoTestJsonLines', () => {
        it('should handle empty output', () => {
            expect(() => processGoTestJsonLines(mockTestItem, runCtx, '')).to.not.throw();
            expect(startedTests).to.be.empty;
            expect(passedTests).to.be.empty;
            expect(failedTests).to.be.empty;
        });

        it('should mark test as started on "run" action', () => {
            const childTest = mockController.createTestItem('test-file::TestExample', 'TestExample', mockTestItem.uri);
            (childTest as any).parent = mockTestItem;
            mockTestItem.children.add(childTest);

            const output = JSON.stringify({
                Action: 'run',
                Test: 'TestExample',
                Package: 'example',
            });

            processGoTestJsonLines(mockTestItem, runCtx, output);

            expect(startedTests).to.have.lengthOf(1);
            expect(startedTests[0].id).to.equal('test-file::TestExample');
        });

        it('should mark test as passed with duration', () => {
            const childTest = mockController.createTestItem('test-file::TestExample', 'TestExample', mockTestItem.uri);
            (childTest as any).parent = mockTestItem;
            mockTestItem.children.add(childTest);

            const output = JSON.stringify({
                Action: 'pass',
                Test: 'TestExample',
                Package: 'example',
                Elapsed: 0.123,
            });

            processGoTestJsonLines(mockTestItem, runCtx, output);

            expect(passedTests).to.have.lengthOf(1);
            expect(passedTests[0].test.id).to.equal('test-file::TestExample');
            expect(passedTests[0].duration).to.equal(123); // 0.123s * 1000
        });

        it('should mark test as failed with error messages', () => {
            const childTest = mockController.createTestItem('test-file::TestExample', 'TestExample', mockTestItem.uri);
            (childTest as any).parent = mockTestItem;
            mockTestItem.children.add(childTest);

            const output = [
                JSON.stringify({
                    Action: 'output',
                    Test: 'TestExample',
                    Output: '    test_file.go:10: assertion failed\n',
                }),
                JSON.stringify({
                    Action: 'fail',
                    Test: 'TestExample',
                    Elapsed: 0.456,
                }),
            ].join('\n');

            processGoTestJsonLines(mockTestItem, runCtx, output);

            expect(failedTests).to.have.lengthOf(1);
            expect(failedTests[0].test.id).to.equal('test-file::TestExample');
            expect(failedTests[0].duration).to.equal(456);
            expect(failedTests[0].messages).to.have.lengthOf(1);
        });

        it('should mark test as skipped', () => {
            const childTest = mockController.createTestItem('test-file::TestExample', 'TestExample', mockTestItem.uri);
            (childTest as any).parent = mockTestItem;
            mockTestItem.children.add(childTest);

            const output = JSON.stringify({
                Action: 'skip',
                Test: 'TestExample',
                Package: 'example',
            });

            processGoTestJsonLines(mockTestItem, runCtx, output);

            expect(skippedTests).to.have.lengthOf(1);
            expect(skippedTests[0].id).to.equal('test-file::TestExample');
        });

        it('should handle nested subtests', () => {
            const parentTest = mockController.createTestItem('test-file::TestParent', 'TestParent', mockTestItem.uri);
            const childTest = mockController.createTestItem('test-file::TestParent/subtest', 'subtest', mockTestItem.uri);
            (childTest as any).parent = parentTest;
            (parentTest as any).parent = mockTestItem;

            parentTest.children.add(childTest);
            mockTestItem.children.add(parentTest);

            const output = JSON.stringify({
                Action: 'pass',
                Test: 'TestParent/subtest',
                Package: 'example',
                Elapsed: 0.1,
            });

            processGoTestJsonLines(mockTestItem, runCtx, output);

            expect(passedTests).to.have.lengthOf(1);
            expect(passedTests[0].test.id).to.equal('test-file::TestParent/subtest');
        });

        it('should ignore package-level events without Test field', () => {
            const output = JSON.stringify({
                Action: 'pass',
                Package: 'example',
                Elapsed: 1.5,
            });

            processGoTestJsonLines(mockTestItem, runCtx, output);

            expect(startedTests).to.be.empty;
            expect(passedTests).to.be.empty;
        });

        it('should ignore cont and pause actions', () => {
            const childTest = mockController.createTestItem('test-file::TestExample', 'TestExample', mockTestItem.uri);
            (childTest as any).parent = mockTestItem;
            mockTestItem.children.add(childTest);

            const output = [
                JSON.stringify({ Action: 'cont', Test: 'TestExample' }),
                JSON.stringify({ Action: 'pause', Test: 'TestExample' }),
            ].join('\n');

            processGoTestJsonLines(mockTestItem, runCtx, output);

            expect(startedTests).to.be.empty;
            expect(passedTests).to.be.empty;
        });

        it('should handle multiple tests in sequence', () => {
            const test1 = mockController.createTestItem('test-file::TestOne', 'TestOne', mockTestItem.uri);
            const test2 = mockController.createTestItem('test-file::TestTwo', 'TestTwo', mockTestItem.uri);
            (test1 as any).parent = mockTestItem;
            (test2 as any).parent = mockTestItem;

            mockTestItem.children.add(test1);
            mockTestItem.children.add(test2);

            const output = [
                JSON.stringify({ Action: 'run', Test: 'TestOne' }),
                JSON.stringify({ Action: 'pass', Test: 'TestOne', Elapsed: 0.1 }),
                JSON.stringify({ Action: 'run', Test: 'TestTwo' }),
                JSON.stringify({ Action: 'fail', Test: 'TestTwo', Elapsed: 0.2 }),
            ].join('\n');

            processGoTestJsonLines(mockTestItem, runCtx, output);

            expect(startedTests).to.have.lengthOf(2);
            expect(passedTests).to.have.lengthOf(1);
            expect(failedTests).to.have.lengthOf(1);
        });
    });

    describe('parseGoTestOutcomeLines', () => {
        it('should handle empty output', () => {
            expect(() => parseGoTestOutcomeLines(mockTestItem, runCtx, '')).to.not.throw();
        });

        it('should parse RUN line and mark test as started', () => {
            const childTest = mockController.createTestItem('test-file::TestExample', 'TestExample', mockTestItem.uri);
            (childTest as any).parent = mockTestItem;
            mockTestItem.children.add(childTest);

            const output = '=== RUN   TestExample';

            parseGoTestOutcomeLines(mockTestItem, runCtx, output);

            expect(startedTests).to.have.lengthOf(1);
            expect(startedTests[0].id).to.equal('test-file::TestExample');
        });

        it('should parse PASS outcome with duration', () => {
            const childTest = mockController.createTestItem('test-file::TestExample', 'TestExample', mockTestItem.uri);
            (childTest as any).parent = mockTestItem;
            mockTestItem.children.add(childTest);

            const output = '--- PASS: TestExample (0.15s)';

            parseGoTestOutcomeLines(mockTestItem, runCtx, output);

            expect(passedTests).to.have.lengthOf(1);
            expect(passedTests[0].duration).to.equal(150);
        });

        it('should parse FAIL outcome with duration', () => {
            const childTest = mockController.createTestItem('test-file::TestExample', 'TestExample', mockTestItem.uri);
            (childTest as any).parent = mockTestItem;
            mockTestItem.children.add(childTest);

            const output = '--- FAIL: TestExample (0.25s)';

            parseGoTestOutcomeLines(mockTestItem, runCtx, output);

            expect(failedTests).to.have.lengthOf(1);
            expect(failedTests[0].duration).to.equal(250);
        });

        it('should parse SKIP outcome', () => {
            const childTest = mockController.createTestItem('test-file::TestExample', 'TestExample', mockTestItem.uri);
            (childTest as any).parent = mockTestItem;
            mockTestItem.children.add(childTest);

            const output = '--- SKIP: TestExample (0.00s)';

            parseGoTestOutcomeLines(mockTestItem, runCtx, output);

            expect(skippedTests).to.have.lengthOf(1);
            expect(skippedTests[0].id).to.equal('test-file::TestExample');
        });

        it('should handle nested test outcomes', () => {
            const parentTest = mockController.createTestItem('test-file::TestParent', 'TestParent', mockTestItem.uri);
            const childTest = mockController.createTestItem('test-file::TestParent/subtest', 'subtest', mockTestItem.uri);
            (childTest as any).parent = parentTest;
            (parentTest as any).parent = mockTestItem;

            parentTest.children.add(childTest);
            mockTestItem.children.add(parentTest);

            const output = [
                '=== RUN   TestParent',
                '=== RUN   TestParent/subtest',
                '--- PASS: TestParent/subtest (0.01s)',
                '--- PASS: TestParent (0.02s)',
            ].join('\n');

            parseGoTestOutcomeLines(mockTestItem, runCtx, output);

            expect(startedTests).to.have.lengthOf(2);
            expect(passedTests).to.have.lengthOf(2);
        });

        it('should handle multi-line output with mixed content', () => {
            const childTest = mockController.createTestItem('test-file::TestExample', 'TestExample', mockTestItem.uri);
            (childTest as any).parent = mockTestItem;
            mockTestItem.children.add(childTest);

            const output = [
                '=== RUN   TestExample',
                'some debug output',
                'more output',
                '--- PASS: TestExample (0.10s)',
            ].join('\n');

            parseGoTestOutcomeLines(mockTestItem, runCtx, output);

            expect(startedTests).to.have.lengthOf(1);
            expect(passedTests).to.have.lengthOf(1);
        });
    });
});
