import * as vscode from 'vscode';
import { Code4i } from './code4i';
import { initializeAFSBrowser } from './views/serversBrowser';


export async function activate(context: vscode.ExtensionContext) {
	await Code4i.initialize(context);
	initializeAFSBrowser(context);
	context.subscriptions.push(
		vscode.commands.registerCommand("arcad-afs-for-ibm-i.open.online.help", () => vscode.commands.executeCommand("vscode.open","https://arcad-software.github.io/arcad-ibmi-servers"))
	);
}

export function deactivate() {

}