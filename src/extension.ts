// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { GoTestController } from './testController';
import * as cp from 'child_process';
import { promisify } from 'util';
import { get } from 'http';
import { addTestFile, findInitialFiles, getWorkspaceTestPatterns } from './testResolver';
import { GoTestRunner } from './testRunner';

// const execFile = promisify(cp.execFile);
// /**
//  * Reproduces the API of the Go extension for type safety.
//  */
// interface ExtensionAPI {
// 	isPreview: boolean;
// 	settings: {
// 		getExecutionCommand(toolName: string, resource?: vscode.Uri): CommandInvocation | undefined;
// 	};
// }
// interface CommandInvocation {
// 	binPath: string;
// }
// const goExt = vscode.extensions.getExtension<ExtensionAPI>('golang.go');
// export type TestData = TestCase | TableTestCase;
// export const testData = new WeakMap<vscode.TestItem, TestData>();

export async function activate(context: vscode.ExtensionContext) {
	vscode.window.showInformationMessage('Go Testing Plus Extension Activated');

	const ctrl = new GoTestController();
	const testRunner = new GoTestRunner(ctrl);

	ctrl.createRunProfile(
		'Go+',
		vscode.TestRunProfileKind.Run,
		async (request, token) => testRunner.runHandler(request, token),
		true,
	);

	// ctrl.createRunProfile(
	// 	'Go+ (Debug)',
	// 	vscode.TestRunProfileKind.Debug,
	// 	async (request, token) => testRunner.runHandler(request, token),
	// 	true,
	// );

	context.subscriptions.push(ctrl);

	context.subscriptions.push(
		...getWorkspaceTestPatterns().map(({ pattern }) => {
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);

			watcher.onDidCreate(uri => {
				addTestFile(ctrl, uri);
			});
			watcher.onDidChange(async uri => {
				addTestFile(ctrl, uri);
			});
			watcher.onDidDelete(uri =>
				ctrl.items.delete(uri.toString())
			);

			findInitialFiles(ctrl, pattern);

			return watcher;
		})
	);

}

// This method is called when your extension is deactivated
export function deactivate() { }


