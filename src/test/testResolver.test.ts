import {
    getWorkspaceTestPatterns,
    resolveTestItemByEscapedName,
    processTestFile
} from '../testResolver';
import * as vscode from 'vscode';

let expect: Chai.ExpectStatic;

describe('testResolver', () => {
    before(async () => {
        expect = (await import('chai')).expect;
    });
    let mockController: vscode.TestController;

    beforeEach(() => {
        const controllerItems = new Map<string, vscode.TestItem>();
        mockController = {
            items: {
                get: (id: string) => controllerItems.get(id),
                add: (item: vscode.TestItem) => { controllerItems.set(item.id, item); },
                delete: (id: string) => controllerItems.delete(id),
                replace: (items: readonly vscode.TestItem[]) => {
                    controllerItems.clear();
                    items.forEach(item => controllerItems.set(item.id, item));
                },
                forEach: (callback: any) => controllerItems.forEach(callback),
            } as any,
            createTestItem: (id: string, label: string, uri?: vscode.Uri) => {
                const children = new Map<string, vscode.TestItem>();
                const item: any = {
                    id,
                    label,
                    uri,
                    children: {
                        size: children.size,
                        forEach: (callback: any) => children.forEach(callback),
                        get: (id: string) => children.get(id),
                        add: (item: any) => { children.set(item.id, item); },
                        delete: (id: string) => children.delete(id),
                    },
                    _parent: undefined,
                    get parent() { return this._parent; },
                    set parent(value) { this._parent = value; },
                    canResolveChildren: false,
                    range: undefined,
                };
                return item;
            },
        } as any;
    });


    describe('resolveTestItemByEscapedName', () => {
        it('should return undefined if root test item does not exist', () => {
            const uri = vscode.Uri.file('/test/file_test.go');
            const result = resolveTestItemByEscapedName(mockController, uri, 'TestExample');

            expect(result).to.be.undefined;
        });

        it('should resolve a simple test name', () => {
            const uri = vscode.Uri.file('/test/file_test.go');
            const rootItem = mockController.createTestItem(uri.toString(), 'file_test.go', uri);
            mockController.items.add(rootItem);

            const result = resolveTestItemByEscapedName(mockController, uri, 'TestExample');

            expect(result).to.not.be.undefined;
            expect(result?.label).to.equal('TestExample');
            expect(result?.id).to.include('TestExample');
        });

        it('should handle deep nesting of subtests', () => {
            const uri = vscode.Uri.file('/test/file_test.go');
            const rootItem = mockController.createTestItem(uri.toString(), 'file_test.go', uri);
            mockController.items.add(rootItem);

            const result = resolveTestItemByEscapedName(
                mockController,
                uri,
                'TestParent/level1/level2/level3'
            );

            expect(result).to.not.be.undefined;
            expect(result?.label).to.equal('level3');
        });


        it('should replace underscores with spaces in test names', () => {
            const uri = vscode.Uri.file('/test/file_test.go');
            const rootItem = mockController.createTestItem(uri.toString(), 'file_test.go', uri);
            mockController.items.add(rootItem);

            const result = resolveTestItemByEscapedName(
                mockController,
                uri,
                'TestExample/test_with_underscores'
            );

            expect(result).to.not.be.undefined;
            expect(result?.label).to.equal('test with underscores');
        });

        it('should set canResolveChildren on parent items', () => {
            const uri = vscode.Uri.file('/test/file_test.go');
            const rootItem = mockController.createTestItem(uri.toString(), 'file_test.go', uri);
            mockController.items.add(rootItem);

            resolveTestItemByEscapedName(mockController, uri, 'TestParent/subtest');

            // Check that parent can resolve children
            const parentId = `${uri.toString()}::TestParent`;
            const parent = rootItem.children.get(parentId);
            expect(parent?.canResolveChildren).to.be.true;
        });

        it('should return the last created item in a chain', () => {
            const uri = vscode.Uri.file('/test/file_test.go');
            const rootItem = mockController.createTestItem(uri.toString(), 'file_test.go', uri);
            mockController.items.add(rootItem);

            const result = resolveTestItemByEscapedName(
                mockController,
                uri,
                'TestA/TestB/TestC'
            );

            expect(result).to.not.be.undefined;
            expect(result?.label).to.equal('TestC');
        });
    });

});
