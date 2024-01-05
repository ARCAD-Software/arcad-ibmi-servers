import { CodeForIBMi, IBMiEvent, QsysFsOptions } from "@halcyontech/vscode-ibmi-types";
import vscode from "vscode";

let codeForIBMi: CodeForIBMi;
export namespace Code4i {
  export async function initialize() {
    const codeForIBMiExtension = vscode.extensions.getExtension<CodeForIBMi>('halcyontechltd.code-for-ibmi');
    if (codeForIBMiExtension) {
      codeForIBMi = codeForIBMiExtension.isActive ? codeForIBMiExtension.exports : await codeForIBMiExtension.activate();
      console.log(vscode.l10n.t("The extension 'arcad-afs-for-ibm-i' is now active!"));
    }
    else {
      throw new Error(vscode.l10n.t("The extension 'arcad-afs-for-ibm-i' requires the 'halcyontechltd.code-for-ibmi' extension to be active!"));
    }
  }

  export async function runCommand(command: string, currentLibrary?: string) {
    return codeForIBMi.instance.getConnection().runCommand({
      command,
      env: {
        "&CURLIB": currentLibrary || ''
      }
    });
  }

  export async function runShellCommand(command: string, directory?: string) {
    return codeForIBMi.instance.getConnection().sendCommand({ command, directory });
  }

  export async function runSQL(statement: string) {
    return codeForIBMi.instance.getContent().runSQL(statement);
  }

  export function getConnection() {
    return codeForIBMi.instance.getConnection();
  }

  export function onEvent(event: IBMiEvent, todo: Function) {
    codeForIBMi.instance.onEvent(event, todo);
  }

  export function customUI() {
    return codeForIBMi.customUI();
  }

  export function makeId() {
    return codeForIBMi.tools.makeid();
  }

  export function open(path: string, options?: QsysFsOptions) {
    vscode.commands.executeCommand("code-for-ibmi.openEditable", path, 0, options);
  }
}