import vscode, { l10n } from "vscode";
import { Code4i } from "../code4i";
import { ArcadInstance, ArcadLicense } from "../types";

export namespace ArcadDAO {
  export async function checkArcadExists(){
    return await Code4i.checkObject("ARCAD_SYS", "AARCINSF1", "*FILE");    
  }

  export async function loadInstances() {
    const instanceRows = await Code4i.runSQL(
      `Select INS_JCODE, INS_CTXT, INS_JPRDL, INS_NASPNB ` +
      `From ARCAD_SYS.AARCINSF1 ` +
      `Order by INS_JCODE`
    );

    const instances: ArcadInstance[] = [];
    for (const instance of instanceRows) {
      const code = String(instance.INS_JCODE).trim();
      const library = String(instance.INS_JPRDL).trim();
      let version = undefined;
      try {
        const [versionRow] = await Code4i.runSQL(`Select DATA_AREA_VALUE From Table(QSYS2.DATA_AREA_INFO( DATA_AREA_NAME => 'ARCVERSION', DATA_AREA_LIBRARY => '${library}'))`);
        version = String(versionRow.DATA_AREA_VALUE).trim();
      }
      catch (error: any) {
        vscode.window.showErrorMessage(l10n.t("Error reading instance {0} version: {1}", code, error));
      }

      instances.push({
        code,
        text: String(instance.INS_CTXT).trim(),
        library,
        iasp: instance.INS_NASPNB && instance.INS_NASPNB !== 1 ? String(instance.INS_NASPNB).trim() : undefined,
        version
      });
    }
    return instances;
  }

  export async function readLicenses(instance: ArcadInstance) {
    const library = instance.library;
    const licenses = await Code4i.runSQL(`${[
      licenseQuery(library, 'Skipper developper seats', 'ARLICPGM', 'ARTYPCLE', 'ARDATLIM', 'ARAVERT', 'ARNBDEV'),
      licenseQuery(library, 'ADELIA Interface', 'ARALICPGM', 'ARATYPCLE', 'ARADATLIM', 'ARAAVERT'),
      licenseQuery(library, 'Integrater', 'INLICPGM', 'INTYPCLE', 'INDATLIM', 'INAVERT'),
      licenseQuery(library, 'Deliver', 'DLLICPGM', 'DLTYPCLE', 'DLDATLIM', 'DLAVERT'),
      licenseQuery(library, 'Data Changer', 'ARTLICPGM', 'ARTTYPCLE', 'ARTDATLIM', 'ARTAVERT'),
      licenseQuery(library, 'Transformer Field', 'FRLICPGM', 'FRTYPCLE', 'FRDATLIM', 'FRAVERT'),
      licenseQuery(library, 'Transformer DB', 'TDBLICPGM', 'TDBTYPCLE', 'TDBDATLIM', 'TDBAVERT'),
      licenseQuery(library, 'Transformer Case', 'TFCLICPGM', 'TFCTYPCLE', 'TFCDATLIM', 'TFCAVERT'),
      licenseQuery(library, 'Verifier', 'OBVLICPGM', 'OBVTYPCLE', 'OBVDATLIM', 'OBVAVERT', 'OBVNBDEV'),
      licenseQuery(library, 'Observer', 'OBSLICPGM', 'OBSTYPCLE', 'OBSDATLIM', 'OBSAVERT', 'OBSNBDEV'),
      licenseQuery(library, 'Cloud Key Server', 'CKSLICPGM', 'CKSTYPCLE', 'CKSDATLIM', 'CKSAVERT')
    ].join(" Union ")} Order by NAME`);

    return licenses.map(license => ({
      name: String(license.NAME),
      license: String(license.KEY),
      count: Number(license.NUMLIC),
      type: String(license.TYPE) === "T" ? "T" : "D",
      limit: String(license.LIMIT),
      warning: String(license.WARN)
    }) as ArcadLicense);

    //ALICCVTRPG ACTION(*USE)
  }

  function licenseQuery(library: string, name: string, licenseData: string, typeData: string, limitData: string, warningData: string, countData?: string) {
    return `Select '${name}' as NAME, KEY.DATA_AREA_VALUE As KEY, TYPE.DATA_AREA_VALUE As TYPE, LIMIT.DATA_AREA_VALUE As LIMIT, WARN.DATA_AREA_VALUE As WARN, ${countData ? 'NUMLIC.DATA_AREA_VALUE As NUMLIC' : '-1 as NUMLIC'}
    From Table(QSYS2.DATA_AREA_INFO( DATA_AREA_NAME => '${licenseData}', DATA_AREA_LIBRARY => '${library}')) As KEY    
    Cross Join Table(QSYS2.DATA_AREA_INFO( DATA_AREA_NAME => '${typeData}', DATA_AREA_LIBRARY => '${library}')) As TYPE
    Cross Join Table(QSYS2.DATA_AREA_INFO( DATA_AREA_NAME => '${limitData}', DATA_AREA_LIBRARY => '${library}')) As LIMIT
    Cross Join Table(QSYS2.DATA_AREA_INFO( DATA_AREA_NAME => '${warningData}', DATA_AREA_LIBRARY => '${library}')) As WARN
    ${countData ? `Cross Join Table(QSYS2.DATA_AREA_INFO( DATA_AREA_NAME => '${countData}', DATA_AREA_LIBRARY => '${library}')) As NUMLIC` : ''}`;
  }
}