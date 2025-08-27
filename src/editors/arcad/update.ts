import vscode, { l10n } from "vscode";
import { ArcadDAO } from "../../dao/arcadDAO";
import { CommonDAO } from "../../dao/commonDAO";
import { ArcadInstance } from "../../types";


export async function openUpdateArcadEditor(instance: ArcadInstance, afterInstall?: Function) {
  const updatePackage = await CommonDAO.selectArcadPackage(l10n.t("Select ARCAD update package"));
  if (updatePackage) {
    if (updatePackage.type === "cumulative") {
      let proceed = false;
      if (instance.version && instance.version === updatePackage.fromVersion) {
        proceed = Boolean(await vscode.window.showInformationMessage(l10n.t("Do you want to update ARCAD instance {0} from version {1} to {2}?", instance.code, instance.version, updatePackage.version), { modal: true }, l10n.t("Proceed")));
      }
      else {
        proceed = Boolean(await vscode.window.showWarningMessage(l10n.t("Version mismatch: the selected update package should be applied to an ARCAD version {0}; instance {1} version is {2}. Do you still want to start the update process?", updatePackage.version, instance.code, instance.version || l10n.t("unknown")), { modal: true }, l10n.t("Proceed anyway")));
      }

      if (proceed && await ArcadDAO.update(updatePackage, instance)) {
        afterInstall?.();
      }
    }
    else {
      vscode.window.showWarningMessage(l10n.t("The selected zip file or folder isn't a suitable ARCAD update package."), { detail: l10n.t("It must contain an ARCINST.DTA file and a CUMARCxxx.DTA file") });
    }
  }
}