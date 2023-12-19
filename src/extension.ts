import * as vscode from 'vscode';
import { Code4i } from './code4i';
import { AFSServerWrappers } from './types';
import { initializeAFSBrowser } from './views/afsBrowser';


export async function activate(context: vscode.ExtensionContext) {
	await Code4i.initialize();
	initializeAFSBrowser(context);
}

export function deactivate() {

}

export namespace Configuration {
	function getAllWrappers() {
		return (vscode.workspace.getConfiguration("arcad-afs").get<AFSServerWrappers[]>("wrappers") || []);
	}

	export async function getWrappers() {
		const host = Code4i.getConnection().currentHost;
		const wrappers = getAllWrappers();
		let wrappersForHost = wrappers.find(w => w.host === host);
		if (!wrappersForHost) {
			wrappersForHost = {
				host,
				locations: []
			};
			await updateWrappers(wrappersForHost);
		}
		return wrappersForHost;
	}

	export async function updateWrappers(wrappers: AFSServerWrappers) {
		const allWrappers = getAllWrappers();
		let currentConfig = allWrappers.find(w => w.host === wrappers.host);
		if (currentConfig) {
			currentConfig.locations = wrappers.locations;
		}
		else {
			allWrappers.push(wrappers);
		}

		await vscode.workspace.getConfiguration("arcad-afs").update("wrappers", allWrappers, vscode.ConfigurationTarget.Global);
	}
}