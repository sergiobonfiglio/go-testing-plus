// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { GoTestController } from './testController';
import { addTestFile, findInitialFiles, getWorkspaceTestPatterns } from './testResolver';
import { GoTestRunner } from './testRunner';


export async function activate(context: vscode.ExtensionContext) {
	console.log('Go Testing Plus Extension Activated');

	const ctrl = new GoTestController();
	const testRunner = new GoTestRunner(ctrl);

	ctrl.createRunProfile(
		'Go+',
		vscode.TestRunProfileKind.Run,
		async (request, token) => testRunner.runHandler(request, token),
		true,
	);

	ctrl.createRunProfile(
		'Go+ (Debug)',
		vscode.TestRunProfileKind.Debug,
		async (request, token) => testRunner.debugHandler(request, token),
		true,
	);

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


