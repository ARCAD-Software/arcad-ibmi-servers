import vscode, { l10n } from "vscode";
import { Code4i } from "../../code4i";
import { CommonDAO } from "../../dao/commonDAO";
import { JettyDAO } from "../../dao/jettyDAO";
import { InstallationProperties } from "../../types";

type InstallPage = InstallationProperties & {
  buttons: 'install'
};

export async function openInstallJettyEditor(installationPackage: vscode.Uri) {
  const page = await Code4i.customUI()
    .addInput("install.library", l10n.t("Jetty library"), l10n.t("The name of Jetty's installation library. Leave blank to use package's default value."), { default: "JETTY", maxlength: 10 })
    .addInput("install.directory", l10n.t("IFS folder"), l10n.t("The server IFS installation folder path."), { minlength: 1, maxlength: 5000, regexTest: "^\\/.+$" })
    .addInput("jetty.user", l10n.t("Job user"), l10n.t("The user that will run the server's job. Leave blank to use package's default value."), { minlength: 1, maxlength: 10 })
    .addInput("install.iasp", l10n.t("Library iASP"), l10n.t("If the Jetty library is located in an iASP, specify it here. Leave blank to use *SYSBAS."), { maxlength: 10 })
    .addInput("jetty.port", l10n.t("HTTP port"), l10n.t("The server HTTP port, between 1 and 65535. Leave blank to disable HTTP."), { maxlength: 5, regexTest: `^\\d*$` })
    .addCheckbox("ibmi.secure", l10n.t("Use secure JTOpen connection"), l10n.t("If <code>enabled</code>, the local JTOpen connection opened by the installer will use TLS."))
    .addButtons(
      { id: 'install', label: l10n.t("Install"), requiresValidation: true }
    )
    .loadPage<InstallPage>(l10n.t("Jetty web server installation"));

  if (page && page.data) {
    page.panel.dispose();
    const properties = CommonDAO.toInstallerProperties(page.data);
    properties.set("jetty.secure.port", "0");
    return await JettyDAO.install(installationPackage, properties);
  }
}