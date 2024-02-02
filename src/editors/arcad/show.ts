import vscode, { l10n } from "vscode";
import { Code4i } from "../../code4i";
import { ArcadDAO } from "../../dao/arcadDAO";
import { ArcadInstance, ArcadLicense } from "../../types";
import { addRow } from "../editor-utils";

export async function openShowArcadInstanceEditor(instance: ArcadInstance) {
  const licenses = await vscode.window.withProgress({ title: l10n.t("Gathering instance {0} licenses...", instance.code), location: vscode.ProgressLocation.Notification },
    async () => ArcadDAO.readLicenses(instance));

  Code4i.customUI()
    .addParagraph(`<table>
       ${addRow(l10n.t("Code"), instance.code)}
       ${addRow(l10n.t("Version"), instance.version)}
       ${addRow(l10n.t("Description"), instance.text)}
       ${addRow(l10n.t("Production library"), instance.library)}       
       ${addRow(l10n.t("IASP"), instance.iasp || '*SYSBAS')}
    </table>`)
    .addParagraph(`<vscode-table zebra min-column-width="5" columns='["300px"]'>
    <vscode-table-header slot="header">
      <vscode-table-header-cell>${l10n.t("Product")}</vscode-table-header-cell>
      <vscode-table-header-cell>${l10n.t("Key")}</vscode-table-header-cell>
      <vscode-table-header-cell>${l10n.t("Type")}</vscode-table-header-cell>
      <vscode-table-header-cell>${l10n.t("Count")}</vscode-table-header-cell>
      <vscode-table-header-cell>${l10n.t("Limit")}</vscode-table-header-cell>
    </vscode-table-header>
    <vscode-table-body slot="body">
      ${licenses.map(license => addLicenseRow(license)).join("")}
    </vscode-table-body>
  </vscode-table>`)
    .loadPage(l10n.t("ARCAD instance {0}", instance.code));
}

function addLicenseRow(license: ArcadLicense) {
  return `<vscode-table-row>
    <vscode-table-cell>${license.name}</vscode-table-cell>
    <vscode-table-cell>${license.license}</vscode-table-cell>
    <vscode-table-cell>${license.type === "D" ? l10n.t("Permanent") : l10n.t("Temporary")}</vscode-table-cell>
    <vscode-table-cell>${license.count > -1 ? `${license.count}` : '-'}</vscode-table-cell>
    <vscode-table-cell>${license.type === "T" ? license.limit : '-'}</vscode-table-cell>    
  </vscode-table-row>`;
}