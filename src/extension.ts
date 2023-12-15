import * as vscode from 'vscode';
import { initializeAFSBrowser } from './afsBrowser';

export function activate(context: vscode.ExtensionContext) {	
	initializeAFSBrowser(context);
	console.log(vscode.l10n.t('The extension "arcad-afs-for-ibm-i" is now active!'));
}

// This method is called when your extension is deactivated
export function deactivate() {}
