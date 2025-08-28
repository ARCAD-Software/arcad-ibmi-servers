import vscode, { l10n } from "vscode";
import { ArcadDAO } from "../../dao/arcadDAO";
import { CommonDAO } from "../../dao/commonDAO";
import { ArcadInstance } from "../../types";


export async function patchArcadInstance(instance: ArcadInstance, afterInstall?: Function) {
  const patches = await CommonDAO.selectArcadPatches(l10n.t("Select ARCAD patch files"));
  if (patches) {
    const proceed = await vscode.window.showInformationMessage(l10n.t("Do you want to apply the following patch(es) to ARCAD instance {0} ?", instance.code), { modal: true, detail: patches.map(patch => `- ${patch.name}`).join("\n") }, l10n.t("Proceed"));
    if (proceed && await ArcadDAO.patch(patches, instance)) {
      afterInstall?.();
    }
  }
}