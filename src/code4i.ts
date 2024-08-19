import { CodeForIBMi, IBMiEvent, OpenEditableOptions } from "@halcyontech/vscode-ibmi-types";
import vscode, { l10n } from "vscode";

let codeForIBMi: CodeForIBMi;
export namespace Code4i {
  let subscribe : (event:IBMiEvent, name:string, func:Function) => void;
  export async function initialize(context: vscode.ExtensionContext) {
    const codeForIBMiExtension = vscode.extensions.getExtension<CodeForIBMi>('halcyontechltd.code-for-ibmi');
    if (codeForIBMiExtension) {
      codeForIBMi = codeForIBMiExtension.isActive ? codeForIBMiExtension.exports : await codeForIBMiExtension.activate();
      console.log(vscode.l10n.t("The extension 'arcad-afs-for-ibm-i' is now active!"));
      subscribe = (event:IBMiEvent, name:string, func:Function) => codeForIBMi.instance.subscribe(context, event, name, func);
      subscribe("connected", "Check Java version", checkJava);
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
    return await codeForIBMi.instance.getContent().runSQL(`${statement.endsWith(';') ? statement : statement + ";"}`);
  }

  export function getConnection() {
    return codeForIBMi.instance.getConnection();
  }

  export function listFiles(folder: string) {
    return codeForIBMi.instance.getContent().getFileList(folder);
  }

  export async function checkObject(library: string, name: string, type: string) {
    return codeForIBMi.instance.getContent().checkObject({ library, name, type });
  }

  export function onEvent(event: IBMiEvent, name:string, todo: Function) {
    subscribe(event, name, todo);
  }

  export function customUI() {
    return codeForIBMi.customUI();
  }

  export function makeId() {
    return codeForIBMi.tools.makeid();
  }

  export function open(path: string, options?: OpenEditableOptions) {
    vscode.commands.executeCommand("code-for-ibmi.openEditable", path, options);
  }

  export async function fileExists(file: string) {
    return (await Code4i.runShellCommand(`[ -f ${file} ]`)).code === 0;
  }

  async function checkJava() {
    const [result] = await runSQL(`With JAVA_PTF_GROUP as (
      SELECT PTF_GROUP_TARGET_RELEASE OS,
      Case PTF_GROUP_TARGET_RELEASE
        When 'V7R4M0' Then 'SF99665'
        When 'V7R3M0' Then 'SF99725'
        When 'V7R2M0' Then 'SF99716'
        When 'V7R1M0' Then 'SF99572' End PTF_GROUP,
      Case PTF_GROUP_TARGET_RELEASE
        When 'V7R4M0' Then 10
        When 'V7R3M0' Then 21
        When 'V7R2M0' Then 31
        When 'V7R1M0' Then 44 End PTF_LEVEL  
    FROM QSYS2.GROUP_PTF_INFO
    WHERE PTF_GROUP_DESCRIPTION = 'TECHNOLOGY REFRESH'
    AND PTF_GROUP_STATUS = 'INSTALLED'
    LIMIT 1)
    Select Max(OS) OS,
    PTF_GROUP_NAME PTF,
    Max(PTF_GROUP_LEVEL) CURRENT,
    Max(PTF_LEVEL) REQUIRED
    From  QSYS2.GROUP_PTF_INFO
    Inner Join JAVA_PTF_GROUP On PTF_GROUP = PTF_GROUP_NAME
    Group by PTF_GROUP_NAME;
    `);

    const current = Number(result.CURRENT);
    const required = Number(result.REQUIRED);
    if (current < required) {
      vscode.window.showWarningMessage(l10n.t("Your {0} system's PTF {1} is at level {2} which doesn't allow to run ARCAD servers properly. Please consider upgrading to level {3} or above.", String(result.OS), String(result.PTF), current, required), { modal: true }, l10n.t("Open related issue"))
        .then(open => {
          if (open) {
            vscode.commands.executeCommand("vscode.open", "https://www.ibm.com/support/pages/change-oracle-jce-code-signing-ca-ibm-jdk-80-sr6-fp25-71-sr4-fp75-70-sr10-fp75");
          }
        });
    }
  }
}