import * as vscode from 'vscode';
import { getWorkspaceTestPatterns, findInitialFiles, addTestFile } from './testResolver';


export class GoTestController implements vscode.TestController {
    id: string;
    label: string;
    items: vscode.TestItemCollection;

    baseCtrl: vscode.TestController;

    constructor() {
        this.baseCtrl = vscode.tests.createTestController('goTestingPlusController', 'Go Testing+');
        this.id = this.baseCtrl.id;
        this.label = this.baseCtrl.label;
        this.items = this.baseCtrl.items;

        // Assign handlers to the base controller
        this.baseCtrl.refreshHandler = this.refreshHandler;
        this.baseCtrl.resolveHandler = this.resolveHandler;
    }


    refreshHandler = async (token: vscode.CancellationToken): Promise<void> => {
        if (token.isCancellationRequested) {
            return;
        }

        this.items.replace([]);

        const patterns = getWorkspaceTestPatterns();

        for (const { pattern } of patterns) {
            if (token.isCancellationRequested) { return; }

            try {
                await findInitialFiles(this, pattern);
            } catch (err) {
                console.error(`Error discovering ${pattern}:`, err);
            }
        }
    };

    // from vscode.TestController, used to resolve test items. 
    resolveHandler?: ((item: vscode.TestItem | undefined) => Thenable<void> | void) | undefined =
        async (item?: vscode.TestItem) => {

            if (!item) {
                // Initial discovery - only if no items exist yet
                if (this.items.size === 0) {
                    await Promise.all(
                        getWorkspaceTestPatterns()
                            .map(({ pattern }) => findInitialFiles(this, pattern))
                    );
                }
                return;
            }

            // Resolve children for a specific test item
            if (item.uri && item.canResolveChildren) {
                return addTestFile(this, item.uri);
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