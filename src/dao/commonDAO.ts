import AdmZip from "adm-zip";
import vscode, { l10n } from "vscode";
import { Code4i } from "../code4i";
import { Configuration } from "../configuration";
import { ArcadPackage, InstallationProperties } from "../types";

export namespace CommonDAO {
  const ARCINST = /ARCINST\.DTA/i;
  export const MASTER = /MSTARC (\d{2}\.\d{2}\.\d{2}) V\dR\dM0 MASTER ENG FRA.DTA/i;
  export const CUMULATIVE = /CUMARC (\d{2}\.\d{2}\.\d{2})-(\d{2}\.\d{2}\.\d{2}) V\dR\dM0\.DTA/i;

  export async function selectInstallationPackage(title: string) {
    return (await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'Installation package': ['jar'] },
      title
    }))?.[0];
  }

  export async function selectArcadPackage(title: string): Promise<ArcadPackage | undefined> {
    const selected = (await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'ARCAD Installation package': ['dta', 'zip'] },
      title
    }))?.[0];

    if (selected) {
      const arcadPackage: ArcadPackage = { type: "master", arcinst: "", package: "", version: "" };
      if (/.zip$/i.test(selected.path)) {
        const zipFile = new AdmZip(selected.fsPath);
        const arcinst = zipFile.getEntries().find(entry => ARCINST.test(entry.name));
        if (arcinst) {
          let packageFile = zipFile.getEntries().find(entry => MASTER.test(entry.name));
          if (!packageFile) {
            arcadPackage.type = "cumulative";
            packageFile = zipFile.getEntries().find(entry => CUMULATIVE.test(entry.name));
          }

          if (packageFile) {
            arcadPackage.zip = selected;
            arcadPackage.arcinst = arcinst.entryName;
            arcadPackage.package = packageFile.entryName;
            if (arcadPackage.type === "master") {
              arcadPackage.version = MASTER.exec(packageFile.name)?.[1]!;
            }
            else {
              const versions = CUMULATIVE.exec(packageFile.name)?.[1]!;
              arcadPackage.fromVersion = versions[1];
              arcadPackage.version = versions[2];
            }
            return arcadPackage;
          }
        }
      }
      else if (/.dta$/i.test(selected.path)) {
        const directory = vscode.Uri.joinPath(selected, "..");
        const files = (await vscode.workspace.fs.readDirectory(directory));
        const arcinst = files.find(([file, type]) => type === vscode.FileType.File && ARCINST.test(file));
        if (arcinst) {
          let packageFile = files.find(([file, type]) => type === vscode.FileType.File && MASTER.test(file));
          if (!packageFile) {
            arcadPackage.type = "cumulative";
            packageFile = files.find(([file, type]) => type === vscode.FileType.File && CUMULATIVE.test(file));
          }

          if (packageFile) {
            arcadPackage.arcinst = vscode.Uri.joinPath(directory, arcinst[0]);
            arcadPackage.package = vscode.Uri.joinPath(directory, packageFile[0]);
            if (arcadPackage.type === "master") {
              arcadPackage.version = MASTER.exec(packageFile[0])?.[1]!;
            }
            else {
              const versions = CUMULATIVE.exec(packageFile[0])?.[1]!;
              arcadPackage.fromVersion = versions[1];
              arcadPackage.version = versions[2];
            }
            return arcadPackage;
          }
        }
      }
    }

    return undefined;
  }

  export async function withTempDirectory(directory: string, process: (directory: string) => Promise<boolean>) {
    const prepareDirectory = await Code4i.runShellCommand(`rm -rf ${directory} && mkdir -p ${directory}`);
    if (prepareDirectory.code === 0) {
      try {
        return await process(directory);
      }
      finally {
        await Code4i.runShellCommand(`rm -rf ${directory}`);
      }
    }
    else {
      vscode.window.showErrorMessage(l10n.t("Failed to create temporary directory {0}: {1}", directory, prepareDirectory.stderr));
      return false;
    }
  }

  export async function install(title: string, installationPackage: vscode.Uri, properties: InstallationProperties, installpathProperty: string) {
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: false }, async progress => {
      return CommonDAO.withTempDirectory(`${Code4i.getConnection().getConfig().tempDir}/${Code4i.makeId()}`, async workDirectory => {
        progress.report({ message: l10n.t("uploading installation package"), increment: 33 });
        const setupFile = `${workDirectory}/setup.jar`;
        try {
          await Code4i.getConnection().getContent().uploadFiles([{ local: installationPackage, remote: setupFile }]);
        }
        catch (error: any) {
          vscode.window.showErrorMessage(l10n.t("Failed to upload installation package: {0}", error));
          return false;
        }
        const installationProperties = Array.from(properties);
        progress.report({ message: l10n.t("running installation process"), increment: 33 });
        const installResult = await Code4i.runShellCommand(`java ${installationProperties.map(([key, value]) => `-D${key}=${value}`).join(" ")} -jar ${setupFile} --unattended && echo "${installationProperties.map(([key, value]) => `${key}=${value}`).join("\n")}" > $(ls ${properties.get(installpathProperty)}/*.properties)`, workDirectory);
        progress.report({ increment: 34 });
        if (installResult.code === 0) {
          vscode.window.showInformationMessage(l10n.t("Installation process completed!"));
          return true;
        }
        else {
          vscode.window.showErrorMessage(l10n.t("Installation process failed: {0}", installResult.stderr));
          return false;
        }
      });
    });
  }

  export function toInstallerProperties(data: any) {
    const props = new Map<string, string>();
    props.set("ibmi.secure", "n");
    Object.entries(data).forEach(([key, rawValue]) => {
      if (rawValue) {
        let value;
        switch (typeof rawValue) {
          case "string":
            value = rawValue;
            break;
          case "boolean":
            value = rawValue ? "y" : "n";
            break;

          default:
            value = String(rawValue);
        }
        props.set(key, value);
      }
    });
    return props;
  }

  export function postUpdateRestart(servernName: string, startFunction: Function) {
    switch (Configuration.getPostUpdateAction()) {
      case "Yes":
        startFunction();
        break;

      case "Ask":
        vscode.window.showInformationMessage(l10n.t("Do you want to restart {0} ?", servernName), l10n.t("Restart"))
          .then(restart => {
            if (restart) {
              startFunction();
            }
          });
        break;

      default: //Do nothing
    }
  }
}