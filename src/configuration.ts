import vscode from "vscode";

export namespace Configuration {
	function getConfiguration() {
		return vscode.workspace.getConfiguration('arcadServers');
	}

	export function getPostUpdateAction() {
		return getConfiguration().get<"Yes" | "No" | "Ask">('restartAfterUpdate', "Ask");
	}
}