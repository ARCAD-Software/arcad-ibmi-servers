import { basename } from "path";
import vscode, { l10n } from "vscode";
import { Code4i } from "../code4i";
import { ArcadInstance, ArcadLicense, ArcadPackage, ArcadPatch } from "../types";
import { CommonDAO } from "./commonDAO";

export namespace ArcadDAO {
  export async function checkArcadExists() {
    return await Code4i.checkObject("ARCAD_SYS", "AARCINSF1", "*FILE");
  }

  export async function loadInstanceCodes() {
    return (await Code4i.runSQL(`Select INS_JCODE From ARCAD_SYS.AARCINSF1 Order by INS_JCODE`))
      .map(row => String(row.INS_JCODE).trim());

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
        iasp: instance.INS_NASPNB && instance.INS_NASPNB !== '1' ? String(instance.INS_NASPNB).trim() : undefined,
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

  export async function install(arcadPackage: ArcadPackage, parms: Map<string, string>) {
    const instance = String(parms.get("INSTANCE"));
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: l10n.t(`Installing ARCAD {0} instance {1}`, arcadPackage.version, instance), cancellable: false },
      async progress => await CommonDAO.withTempDirectory(`${Code4i.getConnection().getConfig().tempDir}/${Code4i.makeId()}`, async workDirectory => {
        const connection = Code4i.getConnection();
        try {
          const restored = await uploadAndRestorePackage(arcadPackage, workDirectory, progress);
          if (restored) {
            progress.report({ message: l10n.t("running installation process"), increment: 33 });
            const command = `ARCINST/ARCINST IFSOBJ('${workDirectory}/${restored.archive}') PARMS('${Array.from(parms.set("MSGLANG", "0").set("SAVF", `ARCINST/${restored.saveFile}`)).map(([key, value]) => `${key}(${value})`).join(" ")}')`;
            const install = await CommonDAO.submitAndWait(`ARCINST_${instance}`, command, parms.get("ASP") !== "1" ? parms.get("ASP") : undefined);
            if (install) {
              if ("code" in install) {
                const openOutput = (open?: string) => openProcessOutput(l10n.t("ARCAD {0} installation", instance), open, install.stdout, install.stderr);
                vscode.window.showErrorMessage(l10n.t("Failed to start ARCAD {0} instance {1} installation.", install.code, arcadPackage.version), l10n.t("Open output"))
                  .then(openOutput);
              }
              else {
                const openOutput = (open?: string) => open ? CommonDAO.openJobLog(install) : undefined;
                if (install.successful) {
                  vscode.window.showInformationMessage(l10n.t("ARCAD instance {0} {1} successfully installed.", instance, arcadPackage.version), l10n.t("Open output"))
                    .then(openOutput);
                  return true;
                }
                else {
                  vscode.window.showErrorMessage(l10n.t("Failed to install ARCAD instance {0} {1}. Job ended with severity {2}: {3}",
                    instance,
                    arcadPackage.version,
                    install.severity || 0,
                    install.endReason || "n/a"),
                    l10n.t("Open output"))
                    .then(openOutput);
                }
              }
            }
            else {
              vscode.window.showErrorMessage(l10n.t("Installation aborted: could not compute submitted job name. Consult Code for IBM i output for more details."));
            }
          }
        }
        finally {
          progress.report({message:l10n.t("Clearing temporary install libraries")});
          await Promise.all([
            connection.runCommand({ command: "DLTLIB LIB(ARCINST)", noLibList: true }),
            connection.runCommand({ command: "DLTLIB LIB(ARCCUMLIB2)", noLibList: true }),
            connection.runCommand({ command: "DLTLIB LIB(ARCCUMLIB4)", noLibList: true })
          ]);
        }
        
        return false;
      })
    );
  }

  export async function update(arcadPackage: ArcadPackage, instance: ArcadInstance) {
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: l10n.t(`Updating ARCAD instance {0} to {1}`, instance.code, arcadPackage.version), cancellable: false },
      async progress => await CommonDAO.withTempDirectory(`${Code4i.getConnection().getConfig().tempDir}/${Code4i.makeId()}`, async workDirectory => {
        const connection = Code4i.getConnection();
        try {
          const restored = await uploadAndRestorePackage(arcadPackage, workDirectory, progress);
          if (restored) {
            progress.report({ message: l10n.t("running update process"), increment: 33 });
            const command = `ARCINST/ARCINST IFSOBJ('${workDirectory}/${restored.archive}') PARMS('INSTANCE(${instance.code}) MSGLANG(0) SAVF(ARCINST/${restored.saveFile})')`;
            const update = await CommonDAO.submitAndWait(`ARCUPD_${instance.code}`, command, instance.iasp);
            if (update) {
              if ("code" in update) {
                const openOutput = (open?: string) => openProcessOutput(l10n.t("ARCAD {0} update", instance.code), open, update.stdout, update.stderr);
                vscode.window.showErrorMessage(l10n.t("Failed to start ARCAD {0} instance {1} update.", update.code, arcadPackage.version), l10n.t("Open output"))
                  .then(openOutput);
              }
              else {
                const openOutput = (open?: string) => open ? CommonDAO.openJobLog(update) : undefined;
                if (update.successful) {
                  Code4i.runCommand(`SBMJOB JOB(ARC${instance.code}) JOBD(${instance.library}/AMSGCMDE) USER(*JOBD) RQSDTA(*JOBD)`);
                  vscode.window.showInformationMessage(l10n.t("ARCAD instance {0} successfully updated to {1}.", instance.code, arcadPackage.version), l10n.t("Open output"))
                    .then(openOutput);
                  return true;
                }
                else {
                  vscode.window.showErrorMessage(l10n.t("Failed to update ARCAD instance {0} to {1}. Job ended with severity {2}: {3}",
                    instance.code,
                    arcadPackage.version,
                    update.severity || 0,
                    update.endReason || "n/a"),
                    l10n.t("Open output"))
                    .then(openOutput);
                }
              }
            }
            else {
              vscode.window.showErrorMessage(l10n.t("Update aborted: could not compute submitted job name. Consult Code for IBM i output for more details."));
            }
          }
        }
        finally {
          progress.report({message:l10n.t("Clearing temporary update libraries")});
          await Promise.all([
            connection.runCommand({ command: "DLTLIB LIB(ARCINST)", noLibList: true }),
            connection.runCommand({ command: "DLTLIB LIB(ARCCUMLIB2)", noLibList: true }),
            connection.runCommand({ command: "DLTLIB LIB(ARCCUMLIB4)", noLibList: true })
          ]);
        }
        return false;
      })
    );
  }

  export async function patch(patches: ArcadPatch[], instance: ArcadInstance) {
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: l10n.t(`Patching ARCAD instance {0}`, instance.code), cancellable: false },
      async progress => await CommonDAO.withTempDirectory(`${Code4i.getConnection().getConfig().tempDir}/${Code4i.makeId()}`, async workDirectory => {
        const failed: string[] = [];
        const arcadLibrary = (await Code4i.checkObject("QSYS", `ARC${instance.code}_ENG`, "*LIB")) ? `ARC${instance.code}_ENG` :
          (await Code4i.checkObject("QSYS", `ARC${instance.code}_FRA`, "*LIB")) ? `ARC${instance.code}_FRA` : "";
        if (!arcadLibrary) {
          vscode.window.showErrorMessage(l10n.t("Could not find any ARC{0} language library", instance.code));
          return false;
        }

        const hasArcadLibrary = (await Code4i.getConnection().sendCommand({ command: "liblist" })).stdout
          .split("\n")
          .map(line => line.split(" ")[0].trim())
          .includes(arcadLibrary);

        const increment = 100 / (patches.length * 3);
        for (const patch of patches) {
          const streamfile = `${patch.file}.savf`;
          const saveFile = patch.name;

          progress.report({ increment, message: l10n.t("uploading {0}", saveFile) });
          await Code4i.getConnection().getContent().uploadFiles([{ local: patch.file, remote: `${workDirectory}/${streamfile}` }]);
          try {
            progress.report({ increment, message: l10n.t("restoring {0}", saveFile) });
            let restore = await Code4i.getConnection().sendCommand({
              command: [
                hasArcadLibrary ? '' : `liblist -a ${arcadLibrary}`,
                `system "CPYFRMSTMF FROMSTMF('${streamfile}') TOMBR('/QSYS.LIB/QGPL.LIB/${saveFile}.FILE') MBROPT(*REPLACE)"`,
                `system "RSTLIB SAVLIB(${saveFile}) DEV(*SAVF) SAVF(QGPL/${saveFile}) MBROPT(*ALL) STRJRN(*NO) ALWOBJDIF(*ALL)"`,
                `system "AGENMACCMD MACRO(${saveFile}/RCVFIX)"`
              ]
                .join(" && "),
              directory: workDirectory
            });
            if (restore.code !== 0) {
              vscode.window.showErrorMessage(l10n.t("Failed to restore patch {0}: {1}", saveFile, restore.stderr || restore.stdout));
              break;
            }

            const [commandRow] = await Code4i.runSQL(`select mms_nseq, mms_cstep, LOCATE('val="ABRKMACCMD', Cast(MMS_UCMD as varchar(100) CCSID 37)) POS from ${saveFile}.RCVFIX___S Order by mms_nseq desc limit 1`);
            if (commandRow && Number(commandRow.POS) > 0) {
              const sequence = Number(commandRow.MMS_NSEQ);
              const update = `${workDirectory}/update.sql`;
              await Code4i.getConnection().getContent().writeStreamfileRaw(update, [
                `update ${saveFile}.RCVFIX___S set mms_chld = 'X', mms_cstep = '' where mms_nseq = ${sequence};`,
                `update ${saveFile}.RCVFIX___S set mms_cstep = '${commandRow.MMS_CSTEP}' where mms_nseq = ${sequence - 10};`,
              ].join("\n"));

              const result = await Code4i.runCommand(`RUNSQLSTM SRCSTMF('${update}') COMMIT(*NONE) NAMING(*SQL)`);
              if (result.code !== 0) {
                vscode.window.showErrorMessage(l10n.t("Failed to update patch {0}: {1}", saveFile, restore.stderr || restore.stdout));
                break;
              }
            }

            restore = await Code4i.getConnection().sendCommand({
              command: [
                hasArcadLibrary ? '' : `liblist -a ${arcadLibrary}`,
                `system "AGENMACCMD MACRO(${saveFile}/RCVFIX)"`
              ]
                .filter(Boolean)
                .join(" && ")
            });
            if (restore.code !== 0) {
              vscode.window.showErrorMessage(l10n.t("Failed to restore patch {0}: {1}", saveFile, restore.stderr || restore.stdout));
              break;
            }

            progress.report({ increment, message: l10n.t("installing {0}", saveFile) });
            const install = await CommonDAO.submitAndWait(`${saveFile}`, `${saveFile}/RCVFIX LIB(${saveFile})`, instance.iasp, arcadLibrary);
            if (install) {
              if ("code" in install) {
                const openOutput = (open?: string) => openProcessOutput(l10n.t("ARCAD {0} patch {1}", instance.code, saveFile), open, install.stdout, install.stderr);
                vscode.window.showErrorMessage(l10n.t("Failed to apply patch {0} on ARCAD instance {1}.", saveFile, install.code), l10n.t("Open output"))
                  .then(openOutput);
              }
              else {
                const openOutput = (open?: string) => open ? CommonDAO.openJobLog(install) : undefined;
                if (!install.successful) {
                  failed.push(saveFile);
                  vscode.window.showErrorMessage(l10n.t("Failed to apply patch {0} on ARCAD instance {1}. Job ended with severity {2}: {3}",
                    saveFile,
                    instance.code,
                    install.severity || 0,
                    install.endReason || "n/a"),
                    l10n.t("Open output"))
                    .then(openOutput);
                }
              }
            }
            else {
              vscode.window.showErrorMessage(l10n.t("Patch aborted: could not compute submitted job name. Consult Code for IBM i output for more details."));
            }
          }
          finally {
            Code4i.getConnection().runCommand({ command: `DLTLIB LIB(${saveFile})`, noLibList: true });
          }
        }


        const allOk = (failed.length === 0);
        if (allOk) {
          vscode.window.showInformationMessage(l10n.t("{0} patch(es) applied to ARCAD instance {1}", patches.length, instance.code));
        }
        else {
          vscode.window.showWarningMessage(l10n.t("{0}/{1} patch(es) applied to ARCAD instance {2}", patches.length - failed.length, patches.length, instance.code), { modal: true, detail: l10n.t("Failed patches:\n{0}", failed.map(f => `- ${f}`).join("\n")) });
        }
        return allOk;
      })
    );
  };
}

async function uploadAndRestorePackage(arcadPackage: ArcadPackage, workDirectory: string, progress: vscode.Progress<{ message?: string; increment?: number }>) {
  const type = arcadPackage.type === "master" ? l10n.t("installation") : l10n.t("update");
  const connection = Code4i.getConnection();
  const content = connection.getContent();
  let arcinst;
  let archive;
  try {
    if (arcadPackage.zip && typeof arcadPackage.arcinst === "string" && typeof arcadPackage.package === "string") {
      progress.report({ message: l10n.t("uploading {0} package", type), increment: 16 });
      const zipFile = `${workDirectory}/package.zip`;
      await content.uploadFiles([{ local: arcadPackage.zip, remote: zipFile }]);

      progress.report({ message: l10n.t("extracting {0} package", type), increment: 17 });
      const extract = await connection.runCommand({ command: `CPYFRMARCF FROMARCF('${zipFile}') TODIR('${workDirectory}')`, noLibList: true });
      if (extract.code !== 0) {
        vscode.window.showErrorMessage(l10n.t("Failed to extract {0} package: {1}", type, extract.stderr || extract.stdout));
        return;
      }

      const move = await connection.sendCommand({ command: `mv "${arcadPackage.arcinst}" "${arcadPackage.package}" . && rm ${zipFile}`, directory: workDirectory });
      if (move.code !== 0) {
        vscode.window.showErrorMessage(l10n.t("Failed to find extracted DTA files: {0}", move.stderr || move.stdout));
        return;
      }

      arcinst = basename(arcadPackage.arcinst);
      archive = basename(arcadPackage.package);
    }
    else if (arcadPackage.arcinst && arcadPackage.arcinst instanceof vscode.Uri && arcadPackage.package instanceof vscode.Uri) {
      progress.report({ message: l10n.t("uploading ARCINST package"), increment: 16 });
      const arcinstDta = `${workDirectory}/${basename(arcadPackage.arcinst.path)}`;
      await content.uploadFiles([{ local: arcadPackage.arcinst, remote: arcinstDta }]);

      progress.report({ message: l10n.t("uploading {0} package", type), increment: 17 });
      const mstarcDta = `${workDirectory}/${basename(arcadPackage.package.path)}`;
      await content.uploadFiles([{ local: arcadPackage.package, remote: mstarcDta }]);

      arcinst = basename(arcadPackage.arcinst.path);
      archive = basename(arcadPackage.package.path);
    }
    else {
      return;
    }
  }
  catch (error: any) {
    vscode.window.showErrorMessage(l10n.t("Failed to upload {0} package: {1}", type, error));
    return;
  }

  if (await Code4i.checkObject("QSYS", "ARCINST", "*LIB")) {
    await connection.runCommand({ command: "DLTLIB LIB(ARCINST)", noLibList: true });
  }

  progress.report({ message: l10n.t("restoring {0} files", type), increment: 33 });
  const saveFile = `${arcadPackage.type === "master" ? "MST_" : "CUME"}${arcadPackage.version.replaceAll('.', '')}`;
  const restoreCommand = [
    `system "CPYFRMSTMF FROMSTMF('${arcinst}') TOMBR('/QSYS.LIB/QGPL.LIB/ARCINST.FILE') MBROPT(*REPLACE)"`,
    `system "RSTLIB SAVLIB(ARCINST) DEV(*SAVF) SAVF(QGPL/ARCINST) MBROPT(*ALL) STRJRN(*NO) ALWOBJDIF(*ALL)"`,
    `system "DLTF FILE(QGPL/ARCINST)"`,
    `system "CPYFRMSTMF FROMSTMF('${archive}') TOMBR('/QSYS.LIB/ARCINST.LIB/${saveFile}.FILE') MBROPT(*REPLACE)"`,
  ].join(" && ");
  const restore = await connection.sendCommand({ command: restoreCommand, directory: workDirectory });
  if (restore.code === 0) {
    return { arcinst, archive, saveFile };
  }
  else {
    vscode.window.showErrorMessage(l10n.t("Failed to restore {0} package: {1}", type, restore.stderr || restore.stdout));
  }
}

function openProcessOutput(title: string, action?: string, output?: string, error?: string) {
  if (action) {
    Code4i.customUI()
      .addParagraph(`<pre>${error}</pre>`)
      .addParagraph(`<pre>${output}</pre>`)
      .setOptions({
        fullPage: true,
        css: /* css */ `
                  pre{              
                    background-color: transparent;
                  }
                `
      })
      .loadPage(title);
  }
}