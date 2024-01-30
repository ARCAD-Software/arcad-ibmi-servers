import * as vscode from 'vscode';
import { Code4i } from './code4i';
import { initializeAFSBrowser } from './views/serversBrowser';


export async function activate(context: vscode.ExtensionContext) {
	await Code4i.initialize();
	initializeAFSBrowser(context);
}

export function deactivate() {

}