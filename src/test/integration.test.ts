import * as vscode from 'vscode';
import * as path from 'path';
import * as assert from 'assert';
import { processTestFile } from '../testResolver';

/**
 * Integration tests using real Go test fixture files.
 * These tests run in the VSCode extension host and can use real VSCode APIs.
 */
describe('Integration: Real Go Test Files', () => {
    let controller: vscode.TestController;

    before(function () {
        controller = vscode.tests.createTestController('go-test-integration', 'Go Test Integration');
    });

    after(() => {
        controller.dispose();
    });

    describe('Simple test files', () => {
        it('should detect test functions in simple_test.go', async function () {
            this.timeout(30000);

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            assert.ok(workspaceFolder, 'No workspace folder found');

            const uri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, 'simple_test.go'));

            try {
                const testItem = await processTestFile(controller, uri);
                assert.ok(testItem, 'No test item returned for simple_test.go');

                assert.strictEqual(testItem.label, 'simple_test.go');

                // Check for TestSimple and TestAnother
                const childrenIds = Array.from(testItem.children).map(([_, child]) => child.label);
                assert.ok(childrenIds.includes('TestSimple'), 'TestSimple not found in children');
                assert.ok(childrenIds.includes('TestAnother'), 'TestAnother not found in children');
            } catch (error) {
                assert.fail(`Error processing test file: ${error}`);
            }
        });
    });

    describe('Table-driven tests', () => {
        it('should detect table test cases in table_test.go', async function () {
            // this.timeout(30000);

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            assert.ok(workspaceFolder, 'No workspace folder found');

            const uri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, 'table_test.go'));

            try {
                const testItem = await processTestFile(controller, uri);

                if (!testItem) {
                    assert.fail('No test item returned for table_test.go');
                    return;
                }

                assert.strictEqual(testItem.label, 'table_test.go');

                // Find the TestTableDriven function
                const tableDrivenTest = Array.from(testItem.children)
                    .map(([_, child]) => child)
                    .find(child => child.label === 'TestTableDriven');

                if (tableDrivenTest) {
                    // Should have detected the table test cases
                    const testCases = Array.from(tableDrivenTest.children)
                        .map(([_, child]) => child.label);

                    assert.ok(testCases.includes('positive numbers'), 'positive numbers test case not found');
                    assert.ok(testCases.includes('negative numbers'), 'negative numbers test case not found');
                    assert.ok(testCases.includes('mixed signs'), 'mixed signs test case not found');
                }
            } catch (error) {
                assert.fail(`Error processing test file: ${error}`);
            }
        });
    });

    describe('Nested subtests', () => {
        it('should handle deeply nested test structure', async function () {
            this.timeout(30000);

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            assert.ok(workspaceFolder, 'No workspace folder found');

            const uri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, 'nested_test.go'));

            try {
                const testItem = await processTestFile(controller, uri);

                if (!testItem) {
                    assert.fail('No test item returned for nested_test.go');
                    return;
                }

                // Find TestNested
                const nestedTest = Array.from(testItem.children)
                    .map(([_, child]) => child)
                    .find(child => child.label === 'TestNested');

                if (nestedTest && nestedTest.children.size > 0) {
                    // Should have level 1
                    const level1 = Array.from(nestedTest.children)
                        .map(([_, child]) => child)
                        .find(child => child.label === 'level 1');

                    assert.ok(level1, 'level 1 subtest not found');

                    if (level1 && level1.children.size > 0) {
                        // Should have level 2
                        const level2 = Array.from(level1.children)
                            .map(([_, child]) => child)
                            .find(child => child.label === 'level 2');

                        assert.ok(level2, 'level 2 subtest not found');
                    }
                }
            } catch (error) {
                assert.fail(`Error processing test file: ${error}`);
            }
        });
    });
});
