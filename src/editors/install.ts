import vscode, { l10n } from "vscode";
import { Code4i } from "../code4i";
import { AFSServerDAO } from "../dao/afsDAO";
import { InstallationProperties } from "../types";

type InstallPage = InstallationProperties & {
  buttons: 'install'
};

export async function openInstallEditor(location?: string, installationPackage?: vscode.Uri, afterInstall?: Function) {
  installationPackage = installationPackage || await AFSServerDAO.selectInstallationPackage();
  if (installationPackage && installationPackage.path.toLowerCase().endsWith(".jar")) {
    const page = await Code4i.customUI()
      .addInput("ifsPath", l10n.t("IFS folder"), l10n.t("The server IFS installation folder path."), { minlength: 1, maxlength: 5000, regexTest: "^\\/.+$" })
      .addInput("user", l10n.t("Job user"), l10n.t("The user that will run the server's job. Leave blank to use package's default value."), { minlength: 1, maxlength: 10 })
      .addInput("instance", l10n.t("Name"), l10n.t("The server instance name. Leave blank to use package's default value."), { maxlength: 10 })
      .addInput("library", l10n.t("AFS Starter library"), l10n.t("The AFS Starter library name. Leave blank to use package's default value."), { default: location, maxlength: 10 })
      .addInput("iasp", l10n.t("Library iASP"), l10n.t("If the AFS Starter library is located in an iASP, specify it here. Leave blank to use *SYSBAS."), { maxlength: 10 })
      .addInput("port", l10n.t("HTTP port"), l10n.t("The server HTTP port, between 1 and 65535. Leave blank to use package's default value."), { maxlength: 5, regexTest: `^\\d*$` })
      .addInput("jobqName", l10n.t("Job queue"), l10n.t("The job queue where the server's job is submitted. Leave blank to use package's default value."), { maxlength: 10 })
      .addInput("jobqLibrary", l10n.t("Job queue library"), l10n.t("The above job queue library. Leave blank to use package's default value."), { maxlength: 10 })
      .addButtons(
        { id: 'install', label: l10n.t("Install"), requiresValidation: true }
      )
      .loadPage<InstallPage>(l10n.t("ARCAD server installation"));

    if (page && page.data) {
      page.panel.dispose();

      if (await AFSServerDAO.install(installationPackage, page.data)) {
        afterInstall?.();
      }
    }
  }
}