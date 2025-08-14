import AdmZip from "adm-zip";
import vscode, { l10n } from "vscode";
import { Code4i } from "../code4i";
import { Configuration } from "../configuration";
import { ArcadPackage, InstallationProperties } from "../types";

type Job = {
  job: string
  jobName: string
  jobUser: string
  jobNumber: string
  status: string
  activeStatus?: string
  successful?: boolean
  severity?: number
  endReason?: string
};

export namespace CommonDAO {
  const ARCINST = /ARCINST\.DTA/i;
  export const MASTER = /MSTARC (\d{2}\.\d{2}\.\d{2}) V\dR\dM0 MASTER ENG FRA.DTA/i;
  export const CUMULATIVE = /CUMARC (\d{2}\.\d{2}\.\d{2})-(\d{2}\.\d{2}\.\d{2})( V\dR\dM0)?.DTA/i;

  export async function selectInstallationPackage(title: string) {
    return (await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'Installation package': ['jar'] },
      title
    }))?.[0];
  }

  export async function selectArcadPackage(title: string): Promise<ArcadPackage | undefined> {
    const selected = (await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'ARCAD Installation package': ['dta', 'zip'] },
      title
    }))?.[0];

    if (selected) {
      const arcadPackage: ArcadPackage = { type: "master", arcinst: "", package: "", version: "" };
      if (/.zip$/i.test(selected.path)) {
        const zipFile = new AdmZip(selected.fsPath);
        const arcinst = zipFile.getEntries().find(entry => ARCINST.test(entry.name));
        if (arcinst) {
          let packageFile = zipFile.getEntries().find(entry => MASTER.test(entry.name));
          if (!packageFile) {
            arcadPackage.type = "cumulative";
            packageFile = zipFile.getEntries().find(entry => CUMULATIVE.test(entry.name));
          }

          if (packageFile) {
            arcadPackage.zip = selected;
            arcadPackage.arcinst = arcinst.entryName;
            arcadPackage.package = packageFile.entryName;
            if (arcadPackage.type === "master") {
              arcadPackage.version = MASTER.exec(packageFile.name)?.[1]!;
            }
            else {
              const versions = CUMULATIVE.exec(packageFile.name)!;
              arcadPackage.fromVersion = versions[1];
              arcadPackage.version = versions[2];
            }
            return arcadPackage;
          }
        }
      }
      else if (/.dta$/i.test(selected.path)) {
        const directory = vscode.Uri.joinPath(selected, "..");
        const files = (await vscode.workspace.fs.readDirectory(directory));
        const arcinst = files.find(([file, type]) => type === vscode.FileType.File && ARCINST.test(file));
        if (arcinst) {
          let packageFile = files.find(([file, type]) => type === vscode.FileType.File && MASTER.test(file));
          if (!packageFile) {
            arcadPackage.type = "cumulative";
            packageFile = files.find(([file, type]) => type === vscode.FileType.File && CUMULATIVE.test(file));
          }

          if (packageFile) {
            arcadPackage.arcinst = vscode.Uri.joinPath(directory, arcinst[0]);
            arcadPackage.package = vscode.Uri.joinPath(directory, packageFile[0]);
            if (arcadPackage.type === "master") {
              arcadPackage.version = MASTER.exec(packageFile[0])?.[1]!;
            }
            else {
              const versions = CUMULATIVE.exec(packageFile[0])!;
              arcadPackage.fromVersion = versions[1];
              arcadPackage.version = versions[2];
            }
            return arcadPackage;
          }
        }
      }
    }

    return undefined;
  }

  export async function withTempDirectory(directory: string, process: (directory: string) => Promise<boolean>) {
    const prepareDirectory = await Code4i.runShellCommand(`rm -rf ${directory} && mkdir -p ${directory}`);
    if (prepareDirectory.code === 0) {
      try {
        return await process(directory);
      }
      finally {
        await Code4i.runShellCommand(`rm -rf ${directory}`);
      }
    }
    else {
      vscode.window.showErrorMessage(l10n.t("Failed to create temporary directory {0}: {1}", directory, prepareDirectory.stderr));
      return false;
    }
  }

  export async function install(title: string, installationPackage: vscode.Uri, properties: InstallationProperties, installpathProperty: string) {
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: false }, async progress => {
      return CommonDAO.withTempDirectory(`${Code4i.getConnection().getConfig().tempDir}/${Code4i.makeId()}`, async workDirectory => {
        progress.report({ message: l10n.t("uploading installation package"), increment: 33 });
        const setupFile = `${workDirectory}/setup.jar`;
        try {
          await Code4i.getConnection().getContent().uploadFiles([{ local: installationPackage, remote: setupFile }]);
        }
        catch (error: any) {
          vscode.window.showErrorMessage(l10n.t("Failed to upload installation package: {0}", error));
          return false;
        }
        const installationProperties = Array.from(properties);
        progress.report({ message: l10n.t("running installation process"), increment: 33 });
        const installResult = await Code4i.runShellCommand(`java ${installationProperties.map(([key, value]) => `-D${key}=${value}`).join(" ")} -jar ${setupFile} --unattended && echo "${installationProperties.map(([key, value]) => `${key}=${value}`).join("\n")}" > $(ls ${properties.get(installpathProperty)}/*.properties)`, workDirectory);
        progress.report({ increment: 34 });
        if (installResult.code === 0) {
          vscode.window.showInformationMessage(l10n.t("Installation process completed!"));
          return true;
        }
        else {
          vscode.window.showErrorMessage(l10n.t("Installation process failed: {0}", installResult.stderr));
          return false;
        }
      });
    });
  }

  export function toInstallerProperties(data: any) {
    const props = new Map<string, string>();
    props.set("ibmi.secure", "n");
    Object.entries(data).forEach(([key, rawValue]) => {
      if (rawValue) {
        let value;
        switch (typeof rawValue) {
          case "string":
            value = rawValue;
            break;
          case "boolean":
            value = rawValue ? "y" : "n";
            break;

          default:
            value = String(rawValue);
        }
        props.set(key, value);
      }
    });
    return props;
  }

  export function postUpdateRestart(servernName: string, startFunction: Function) {
    switch (Configuration.getPostUpdateAction()) {
      case "Yes":
        startFunction();
        break;

      case "Ask":
        vscode.window.showInformationMessage(l10n.t("Do you want to restart {0} ?", servernName), l10n.t("Restart"))
          .then(restart => {
            if (restart) {
              startFunction();
            }
          });
        break;

      default: //Do nothing
    }
  }

  export async function submitAndWait(jobName: string, command: string, iasp?: string) {
    const submitResult = await Code4i.getConnection().runCommand({ command: `SBMJOB JOB(${jobName}) SYSLIBL(*SYSVAL) CURLIB(*USRPRF) INLLIBL(*JOBD) CMD(${command}) INLASPGRP(${iasp || "*CURRENT"})`, noLibList: true });
    if (submitResult.code === 0) {
      const submitMessage = Code4i.tools().parseMessages(submitResult.stderr || submitResult.stdout).findId("CPC1221")?.text;
      if (submitMessage) {
        const [job, jobNumber, jobUser, jobName] = /([^\/\s]+)\/([^\/]+)\/([^\/\s]+)/.exec(submitMessage) || [];
        if (job) {
          const targetJob: Job = { job, jobNumber, jobUser, jobName, status: "*UNKNOWN" };
          let done = false;
          let tries = 10;
          while (!done) {
            const [row] = (await Code4i.runSQL(`select V_JOB_STATUS status,	V_ACTIVE_JOB_STATUS active_status from table(QSYS2.get_job_info('${targetJob.job}'))`));
            targetJob.status = row.STATUS as string;
            targetJob.activeStatus = row.ACTIVE_STATUS as string;

            switch (targetJob.status) {
              case "*ACTIVE":
                tries = 0;
                switch (targetJob.activeStatus) {
                  case "HLD":
                    await vscode.window.showWarningMessage(l10n.t("ARCAD job {0} is held!", targetJob.activeStatus), { modal: true, detail: l10n.t("Release the job and close this dialog to resume the process.") });
                    break;

                  case "MSGW":
                    const detail = (await Code4i.runSQL(`select MESSAGE_TEXT from table(qsys2.joblog_info('${targetJob.job}')) order by ordinal_position desc fetch first 3 row only`))
                      .map(row => `- ${row.MESSAGE_TEXT}`)
                      .join("\n");
                    await vscode.window.showWarningMessage(l10n.t("ARCAD job {0} is in message wait!", targetJob.activeStatus), { modal: true, detail });
                    break;
                }
                break;

              case "*OUTQ":
                done = true;
                break;

              default: //JOBQ or UNKNOWN
                done = (tries-- > 0);
            }

            if (!done) {
              await sleep(2000);
            }
          }

          const [row] = await Code4i.runSQL(`select COMPLETION_STATUS, JOB_END_SEVERITY, JOB_END_REASON from table(QSYS2.JOB_INFO(job_type_filter => '*BATCH', JOB_USER_FILTER => '${targetJob.jobUser}', JOB_STATUS_FILTER => '*OUTQ')) Where JOB_NAME = '${targetJob.job}' fetch first row only`);
          if (row) {
            targetJob.successful = String(row.COMPLETION_STATUS) === "NORMAL";
            targetJob.severity = Number(row.JOB_END_SEVERITY);
            targetJob.endReason = String(row.JOB_END_REASON);
          }
          return targetJob;
        }
      };
    }
    else {
      return submitResult;
    }
  }

  function sleep(milliseconds = 1000) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  export async function openJobLog(job: Job) {
    vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: l10n.t("Opening {0} job log", job.job) }, async () => {
      const wrksplf = await Code4i.runCommand(`WRKSPLF SELECT(*ALL) JOB(${job.job}) OUTPUT(*PRINT)`);
      if (wrksplf.code === 0) {
        const [name, user, queue, userData, status, pages, copy, form, priority, createDate, createTime, number] = wrksplf.stdout.split("\n")
          .map(line => line.split(" ").filter(part => Boolean(part.trim())))
          .find(parts => parts[0] === "QPJOBLOG" && parts[3] === job.jobName) || [];

        if (number) {
          try {
            await Code4i.runSQL("Drop table QTEMP.SPOOL");
          }
          catch (error) {
            //Ignore
          }
          const jobLog = (await Code4i.runSQL([
            "@CRTPF FILE(QTEMP/SPOOL) RCDLEN(133) SIZE(*NOMAX)",
            `@CPYSPLF FILE(${name}) TOFILE(QTEMP/SPOOL) JOB(${job.job}) SPLNBR(${number})`,
            "Select rtrim(SPOOL) SPOOL from QTEMP.SPOOL"
          ].join("\n")))
            .map(row => String(row.SPOOL));

          if (jobLog.length) {
            vscode.workspace.openTextDocument({ content: jobLog.join("\n"), language: "log" });
          }
        }
      }
      else {
        vscode.window.showWarningMessage(`No job log spooled file found for job ${job.job}!`);
      }
    });
  }
}

