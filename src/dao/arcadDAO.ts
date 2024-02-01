//01 M MACROMAKER Process Manager : MMLICPGM   MMNBUSR    MMTYPCLE   MMDATLIM   MMAVERT    *NOTCHK
//02 M REPOSITORY Open Repository : AROLICPGM  ARONBUSR   AROTYPCLE  ARODATLIM  AROAVERT   *NOTCHK
//03 M            Skipper/Builder
//04 S ARCAD_CM     Full dev.seat : ARLICPGM   ARNBDEV    ARTYPCLE   ARDATLIM   ARAVERT
//05 S ARCAD_ADL    Interf.ADELIA : ARALICPGM             ARATYPCLE  ARADATLIM  ARAAVERT
//07 M ARCAD_INT  Integrater. . . : INLICPGM              INTYPCLE   INDATLIM   INAVERT
//08 M ARCAD_DLV  Deliver . . . . : DLLICPGM              DLTYPCLE   DLDATLIM   DLAVERT
//09 M ARCAD_DTC  Data Changer. . : ARTLICPGM             ARTTYPCLE  ARTDATLIM  ARTAVERT
//10 M ARCAD_FRM  Transformer Fld : FRLICPGM              FRTYPCLE   FRDATLIM   FRAVERT
//11 M TRANSF_DB  Transformer DB  : TDBLICPGM             TDBTYPCLE  TDBDATLIM  TDBAVERT
//12 M TRANSF_CAS Transform. Case : TFCLICPGM             TFCTYPCLE  TFCDATLIM  TFCAVERT
//14 M VERIFIER   Verifier  . . . : OBVLICPGM  OBVNBDEV   OBVTYPCLE  OBVDATLIM  OBVAVERT
//15 M OBSERVER   Observer  . . . : OBSLICPGM  OBSNBDEV   OBSTYPCLE  OBSDATLIM  OBSAVERT
//16
//17 M CLOUDKYSRV Cloud Key Serv. : CKSLICPGM             CKSTYPCLE  CKSDATLIM  CKSAVERT

import { Code4i } from "../code4i";
import { ArcadInstance } from "../types";

export namespace ArcadDAO {
  export async function loadInstances() {
    const instances = await Code4i.runSQL(
      `Select INS_JCODE, INS_CTXT, INS_JPRDL, INS_NASPNB, DATA_AREA_VALUE ` +
      `From ARCAD_SYS.AARCINSF1 ` +
      `Cross Join Table(QSYS2.DATA_AREA_INFO( DATA_AREA_NAME => 'ARCVERSION', DATA_AREA_LIBRARY => INS_JPRDL)) ` +
      `Order by INS_JCODE`
    );

    return instances.map(instance => ({
      code: String(instance.INS_JCODE).trim(),
      text: String(instance.INS_CTXT).trim(),
      library: String(instance.INS_JPRDL).trim(),
      iasp: instance.INS_NASPNB && instance.INS_NASPNB !== '1' ? String(instance.INS_NASPNB).trim() : undefined,
      version: String(instance.DATA_AREA_VALUE).trim(),
    }) as ArcadInstance);
  }
}