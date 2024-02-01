import { ComplexTab } from "@halcyontech/vscode-ibmi-types/api/CustomUI";
import vscode, { l10n } from "vscode";
import { Code4i } from "../../code4i";
import { JettyServer } from "../../types";

export async function openShowJettyServerEditor(server: JettyServer) {
  const instanceSection = Code4i.customUI()
    .addParagraph(`<table>
      ${addRow(l10n.t("Library"), server.library)}
       ${addRow(l10n.t("IFS path"), server.ifsPath)}
       ${addRow(l10n.t("HTTP port"), server.configuration.httpPort || "-")}
       ${addRow(l10n.t("HTTPS port"), server.configuration.httpsPort || "-")}
       ${addRow(l10n.t("Running"), `${server.running ? l10n.t("Yes") : l10n.t("No")}`)}
    </table>`);
  const tabs: ComplexTab[] = [{ label: server.library, fields: instanceSection.fields }];

  if (server.running) {
    await vscode.window.withProgress({ title: l10n.t("Gathering Jetty information..."), location: vscode.ProgressLocation.Notification }, async () => {
      const [job] = await Code4i.runSQL(`Select * From Table(QSYS2.JOB_INFO(` +
        `JOB_USER_FILTER => '${server.jobUser}',` +
        `JOB_STATUS_FILTER => '*ACTIVE', ` +
        `JOB_TYPE_FILTER => '*BATCH')) ` +
        `Where JOB_NAME = '${server.jobNumber}/${server.jobUser}/${server.jobName}'`
      );

      const jobSection = Code4i.customUI()
        .addParagraph(`<table>
        ${addRow(l10n.t("Name"), job.JOB_NAME)}
        ${addRow(l10n.t("Type"), job.JOB_TYPE_ENHANCED)}
        ${addRow(l10n.t("Status"), job.JOB_STATUS)}
        ${addRow(l10n.t("Subsystem"), job.JOB_SUBSYSTEM)}
        ${addRow(l10n.t("Job description"), `${job.JOB_DESCRIPTION_LIBRARY}/${job.JOB_DESCRIPTION}`)}
        ${addRow(l10n.t("Job queue"), `${job.JOB_QUEUE_LIBRARY}/${job.JOB_QUEUE_NAME}`)}
        ${addRow(l10n.t("Entered system on"), job.JOB_ENTERED_SYSTEM_TIME)}
        ${addRow(l10n.t("Active on"), job.JOB_ACTIVE_TIME)}
        ${addRow(l10n.t("Peack temporary storage"), job.PEAK_TEMPORARY_STORAGE)}
        ${addRow(l10n.t("CCSID"), job.CCSID)}
        ${addRow(l10n.t("Language ID"), job.LANGUAGE_ID)}
        ${addRow(l10n.t("Country ID"), job.COUNTRY_ID)}
        ${addRow(l10n.t("Date format"), job.DATE_FORMAT)}
        ${addRow(l10n.t("Date separator"), job.DATE_SEPARATOR)}
        ${addRow(l10n.t("Time separator"), job.TIME_SEPARATOR)}
        ${addRow(l10n.t("Logging level"), job.MESSAGE_LOGGING_LEVEL)}
        ${addRow(l10n.t("Logging severity"), job.MESSAGE_LOGGING_SEVERITY)}
        ${addRow(l10n.t("Logging text"), job.MESSAGE_LOGGING_TEXT)}
      </table>`);
      tabs.push({ label: l10n.t("Current job"), fields: jobSection.fields });
    });
  }

  Code4i.customUI().addComplexTabs(tabs).loadPage(l10n.t("Show Jetty {0}", server.library));
}

function addRow(key: string, value?: any) {
  if (value !== undefined) {
    return /*html*/ `<tr>
      <td><vscode-label>${key}:</vscode-label></td>
      <td>${value}</td>
    </tr>`;
  }
  else {
    return /*html*/ `<tr>
      <td colspan="2"><h3><u>${key}</u></h3></td>
    </tr>`;
  }
}