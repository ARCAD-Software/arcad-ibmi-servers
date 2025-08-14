import { SelectItem } from "@halcyontech/vscode-ibmi-types/webviews/CustomUI";
import vscode, { l10n } from "vscode";
import { Code4i } from "../../code4i";
import { ArcadDAO } from "../../dao/arcadDAO";
import { CommonDAO } from "../../dao/commonDAO";

const LANGUAGES: SelectItem[] = [{ value: "ENG", description: l10n.t("English"), text: "" }, { value: "FRA", description: l10n.t("French"), text: "" }];

export async function openInstallArcadEditor(afterInstall?: Function) {
  const installationPackage = await CommonDAO.selectArcadPackage(l10n.t("Select ARCAD installation package"));
  if (installationPackage?.type === "master") {
    const iasps = (await Code4i.runSQL("select device_description_name name from QSYS2.ASP_INFO where device_description_name != 'null'")).map(row => String(row.NAME));

    const instances = await ArcadDAO.loadInstanceCodes();
    const noMatch = instances.length ? `(?!${instances.join('|')})` : '';
    const instanceTest = `^${noMatch}[A-Z0-9]{2}$`;

    const page = await Code4i.customUI()
      .addInput("INSTANCE", l10n.t("ARCAD instance"), l10n.t("ARCAD instance code which is a two uppercase alphanumerical characters code."), { minlength: 2, maxlength: 2, regexTest: instanceTest })
      .addSelect("LANG1", l10n.t("Main language"), LANGUAGES)
      .addSelect("LANG2", l10n.t("Secondary language"), [{ value: "", text: l10n.t("No secondary language will be installed"), description: l10n.t("None") }, ...LANGUAGES])
      .addCheckbox("DEMO", l10n.t("Install demo application"))
      .addSelect("ASP", l10n.t("Installation ASP"), [{ value: '1', description: l10n.t("Base ASP"), text: "" }, ...iasps.map(iasp => ({ value: iasp, description: iasp, text: "" }))])
      .addButtons({ id: 'install', label: l10n.t("Install"), requiresValidation: true })
      .loadPage<any>(l10n.t("ARCAD installation"));

    if (page && page.data) {
      page.panel.dispose();

      if (page.data.DEMO) {
        page.data.DEMO = "*YES";
      }

      if (page.data.LANG2 === page.data.LANG1) {
        delete page.data.LANG2;
      }

      delete page.data.buttons;
      const parms = Object.entries(page.data)
        .filter(([key, value]) => Boolean(value))
        .reduce((map, [key, value]) => map.set(key, String(value)), new Map<string, string>);

      if (await ArcadDAO.install(installationPackage, parms)) {
        afterInstall?.();
      }
    }
  }
  else {
    vscode.window.showWarningMessage(l10n.t("The selected zip file or folder isn't a suitable ARCAD installation package."), { detail: l10n.t("It must contain an ARCINST.DTA file and a MSTARCxxx.DTA file") });
  }
}