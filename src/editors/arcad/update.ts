import vscode, { l10n } from "vscode";
import { ArcadDAO } from "../../dao/arcadDAO";
import { CommonDAO } from "../../dao/commonDAO";
import { ArcadInstance } from "../../types";


export async function openUpdateArcadEditor(instance: ArcadInstance, afterInstall?: Function) {
  const updatePackage = await CommonDAO.selectArcadPackage(l10n.t("Select ARCAD update package"));
  if (updatePackage?.type === "cumulative") {

    ok await vscode.window.showInformationMessage("", { detail: , modal: true });
    
    version mismatch await vscode.window.showWarningMessage("", { detail: , modal: true });


    if (proceed) {
      page.panel.dispose();

      if (await ArcadDAO.update(updatePackage, instance)) {
        afterInstall?.();
      }
    }
  }
  else {
    vscode.window.showWarningMessage(l10n.t("The selected zip file or folder isn't a suitable ARCAD update package."), { detail: l10n.t("It must contain an ARCINST.DTA file and a CUMARCxxx.DTA file") });
  }
}