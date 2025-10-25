import * as vscode from 'vscode';
import { getWorkspaceTestPatterns, findInitialFiles, addTestFile } from './testResolver';


export class GoTestController implements vscode.TestController {
    id: string;
    label: string;
    items: vscode.TestItemCollection;

    baseCtrl: vscode.TestController;

    constructor() {

        vscode.tests;
        this.baseCtrl = vscode.tests.createTestController('goTestingPlusController', 'Go Testing+');
        this.id = this.baseCtrl.id;
        this.label = this.baseCtrl.label;
        this.items = this.baseCtrl.items;
    }


    refreshHandler: ((token: vscode.CancellationToken) => Thenable<void> | void) | undefined =
        async (token: vscode.CancellationToken) => {
            if (token.isCancellationRequested) {
                return;
            }

            const promises = getWorkspaceTestPatterns()
                .map(({ pattern }) => findInitialFiles(this, pattern));

            await Promise.race([
                Promise.all(promises),
                new Promise<void>((resolve) => {
                    token.onCancellationRequested(() => resolve());
                })
            ]);
        };

    // from vscode.TestController, used to resolve test items. 
    resolveHandler?: ((item: vscode.TestItem | undefined) => Thenable<void> | void) | undefined =
        async (item?: vscode.TestItem) => {

            if (!item) {
                await Promise.all(
                    getWorkspaceTestPatterns()
                        .map(({ pattern }) => findInitialFiles(this, pattern))
                );
                return;
            }

            if (item.uri) {
                return addTestFile(this, item.uri!);
            }
            return;
        };




    createRunProfile(label: string,
        kind: vscode.TestRunProfileKind,
        runHandler: (request: vscode.TestRunRequest, token: vscode.CancellationToken) =>
            Thenable<void> | void, isDefault?: boolean, tag?: vscode.TestTag, supportsContinuousRun?: boolean):
        vscode.TestRunProfile {
        return this.baseCtrl.createRunProfile(label, kind, runHandler, isDefault, tag, supportsContinuousRun);
    }
    createTestRun(request: vscode.TestRunRequest, name?: string, persist?: boolean): vscode.TestRun {
        return this.baseCtrl.createTestRun(request, name, persist);
    }
    createTestItem(id: string, label: string, uri?: vscode.Uri): vscode.TestItem {
        return this.baseCtrl.createTestItem(id, label, uri);
    }
    invalidateTestResults(items?: vscode.TestItem | readonly vscode.TestItem[]): void {
        this.baseCtrl.invalidateTestResults(items);
    }
    dispose(): void {
        this.baseCtrl.dispose();
    }

}