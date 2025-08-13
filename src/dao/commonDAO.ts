import vscode, { l10n } from "vscode";
import { Code4i } from "../code4i";
import { Configuration } from "../configuration";
import { InstallationProperties } from "../types";

export namespace CommonDAO {
  export async function selectInstallationPackage(title: string) {
    const filter = l10n.t('Installation package');
    return (await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { filter: ['jar'] },
      title
    }))?.[0];
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