
import { l10n } from "vscode";
import { Code4i } from "../code4i";
import { ServerDAO } from "../dao/serverDAO";
import { AFSServer, ServerUpdate } from "../types";

type AFSServerPage = ServerUpdate & {
  buttons: 'save' | 'saveRestart'
};

export async function openEditServerEditor(server: AFSServer, afterSave: (restart?: boolean) => void) {
  const page = await Code4i.customUI()
    .addInput("user", l10n.t("User"), l10n.t("The server job's user"), { default: server.user, maxlength: 10, minlength: 1 })
    .addInput("jobqName", l10n.t("Job queue"), l10n.t("The job queue used to submitt the server's job"), { default: server.jobqName, maxlength: 10, minlength: 1 })
    .addInput("jobqLibrary", l10n.t("Job queue library"), l10n.t("Can be <code>*LIBL</code>"), { default: server.jobqLibrary, maxlength: 10, minlength: 1 })
    .addInput("ifsPath", l10n.t("IFS folder"), l10n.t("The server's IFS installation folder path"), { default: server.ifsPath, minlength: 1, maxlength: 5000 })
    .addInput("javaHome", l10n.t("Java home"), l10n.t("The JRE location used to run the server. Can be <code>*DFT</code> (i.e. default Java home location)"), { default: server.javaHome, minlength: 1, maxlength: 5000 })
    .addInput("javaProps", l10n.t("Java system properties"), l10n.t("Each properties must be separated by a semicolon"), { default: server.javaProps, maxlength: 5000 })
    .addButtons(
      { id: 'save', label: l10n.t("Save"), requiresValidation: true },
      { id: 'saveRestart', label: l10n.t("Save and restart"), requiresValidation: true }
    )
    .loadPage<AFSServerPage>(l10n.t("Edit {0}", server.name));

  if (page && page.data) {
    page.panel.dispose();
    if (await ServerDAO.updateServer(server, page.data)) {
      afterSave(page.data.buttons === "saveRestart");
    }
  }
}