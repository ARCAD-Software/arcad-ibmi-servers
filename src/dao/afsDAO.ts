import axios, { AxiosHeaders } from "axios";
import vscode, { l10n } from "vscode";
import { Code4i } from "../code4i";
import { AFSServer, AFSServerConfiguration, AFSServerUpdate, InstallationProperties } from "../types";
import { CommonDAO } from "./commonDAO";

export namespace AFSServerDAO {
  const CONFIG_FILES = ["org.eclipse.equinox.simpleconfigurator", "config.ini", "osgi.cm.ini"];

  export async function listServers(library: string) {
    const rows = (await Code4i.runSQL(`Select * From ${library}.AFSSERVERS ` +
      `Cross Join Table(QSYS2.GET_JOB_INFO(AFS_JOBNUMBER concat '/' concat AFS_JOBUSER concat '/' concat AFS_JOBNAME)) ` +
      `Order By AFS_NAME For fetch only`)
    );

    const servers: AFSServer[] = [];
    for (const row of rows) {
      servers.push({
        library: library,
        name: String(row.AFS_NAME).trim(),
        jobqName: String(row.AFS_JOBQNAME).trim(),
        jobqLibrary: String(row.AFS_JOBQLIB).trim(),
        ifsPath: String(row.AFS_IFSPATH).trim(),
        user: String(row.AFS_USER).trim(),
        javaProps: String(row.AFS_PROPS).trim(),
        javaHome: String(row.AFS_JAVA_HOME).trim(),
        jobName: String(row.AFS_JOBNAME).trim(),
        jobUser: String(row.AFS_JOBUSER).trim(),
        jobNumber: String(row.AFS_JOBNUMBER).trim().padStart(6, '0'),
        running: Boolean(row.V_JOB_STATUS === '*ACTIVE'),
        jobStatus: row.V_ACTIVE_JOB_STATUS ? String(row.V_ACTIVE_JOB_STATUS).trim() : undefined,
        configuration: await loadConfiguration(String(row.AFS_IFSPATH).trim())
      } as AFSServer);
    }
    return servers;
  }

  async function loadConfiguration(ifsPath: string): Promise<AFSServerConfiguration> {
    const config: AFSServerConfiguration = {};
    if ((await Code4i.runShellCommand(`[ -d ${ifsPath} ]`)).code === 0) {
      const configFile = `${ifsPath}/configuration/osgi.cm.ini`;
      if (await Code4i.fileExists(configFile)) {
        const result = (await Code4i.runShellCommand(`cat ${configFile}`));
        if (result.code === 0 && result.stdout) {
          let section;
          for (const line of result.stdout.split("\n").map(line => line.trim())) {
            if (line && !line.startsWith("#")) {
              if (line.startsWith("[")) {
                section = line.replace('[', '').replace(']', '').trim().toLowerCase();
                config[section] = {};
              }
              else if (section) {
                const [key, value] = line.split("=").map(s => s.trim());
                config[section][key.toLowerCase()] = value;
              }
            }
          }
        }
      }
      else {
        config.error = "noconfig";
      }
    }
    else {
      config.error = "nofolder";
    }
    return config;
  }

  export async function startServer(server: AFSServer, debugPort?: number) {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: server.running ? l10n.t("Restarting ARCAD Server {0}...", server.name) : l10n.t("Starting ARCAD Server {0}...", server.name)
    },
      async progress => {
        return await Code4i.runCommand(`STRAFSSVR INSTANCE(${server.name}) DBGPORT(${debugPort})`, server.library);
      });

    if (result.code === 0) {
      return true;
    }
    else {
      if (server.running) {
        vscode.window.showErrorMessage(l10n.t("Failed to restart ARCAD Server {0}: {1}", server.name, result.stderr));
      }
      else {
        vscode.window.showErrorMessage(l10n.t("Failed to start ARCAD Server {0}: {1}", server.name, result.stderr));
      }
      return false;
    }
  }

  export async function stopServer(server: AFSServer) {
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: l10n.t("Stopping ARCAD Server {0}...", server.name) }, async progress => {
      return await Code4i.runCommand(`ENDAFSSVR INSTANCE(${server.name})`, server.library);
    });
    if (result.code === 0) {
      return true;
    }
    else {
      vscode.window.showErrorMessage(l10n.t("Failed to stop ARCAD Server {0}: {1}", server.name, result.stderr));
      return false;
    }
  }

  export async function deleteServer(server: AFSServer, deleteIFS: boolean) {
    const result = await Code4i.runCommand(`DLTAFSSVR INSTANCE(${server.name}) DELETE(${deleteIFS ? '*YES' : '*NO'})`, server.library);
    if (result.code === 0) {
      if (server.running) {
        vscode.window.showInformationMessage(l10n.t("ARCAD Server {0} successfully stopped and deleted.", server.name));
      }
      else {
        vscode.window.showInformationMessage(l10n.t("ARCAD Server {0} successfully deleted.", server.name));
      }
      return true;
    }
    else {
      vscode.window.showErrorMessage(l10n.t("Failed to delete ARCAD Server {0}: {1}", server.name, result.stdout));
      return false;
    }
  }

  export async function changeServer(server: AFSServer, payload: AFSServerUpdate) {
    const command = [`${server.library}/CHGAFSSVR`, `INSTANCE(${server.name})`];
    if (payload.user !== server.user) {
      command.push(`USER(${payload.user})`);
    }
    if (payload.jobqName !== server.jobqName || payload.jobqLibrary !== server.jobqLibrary) {
      command.push(`JOBQ(${payload.jobqLibrary}/${payload.jobqName})`);
    }
    if (payload.ifsPath !== server.ifsPath) {
      command.push(`IFSPATH('${payload.ifsPath}')`);
    }
    if (payload.javaHome !== server.javaHome) {
      command.push(`JAVAHOME('${payload.javaHome}')`);
    }
    if (payload.javaProps !== server.javaProps) {
      command.push(`PROPS('${payload.javaProps}${payload.javaProps && payload.javaProps.endsWith(';') ? '' : ';'}')`);
    }

    const result = await Code4i.runCommand(command.join(" "), server.library);
    if (result.code === 0) {
      vscode.window.showInformationMessage(l10n.t("ARCAD Server {0} successfully updated", server.name));
      return true;
    }
    else {
      vscode.window.showErrorMessage(l10n.t("Failed to update ARCAD Server {0}: {1}", server.name, result.stdout));
      return false;
    }
  }

  export async function openLogs(server: AFSServer) {
    Code4i.open(`${server.ifsPath}/logs/server.log`, { readonly: true });
  }

  export async function openConfiguration(server: AFSServer) {
    Code4i.open(`${server.ifsPath}/configuration/osgi.cm.ini`, { readonly: server.running });
  }

  export async function clearConfiguration(server: AFSServer) {
    return await vscode.window.withProgress({ title: l10n.t("Clearing {0} configuration area...", server.name), location: vscode.ProgressLocation.Notification }, async () => {
      const configurationDirectory = `${server.ifsPath}/configuration`;
      return CommonDAO.withTempDirectory(`${Code4i.getConnection().getConfig().tempDir}/arcadserver_${server.name}`, async tempDirectory => {
        const clearCommand = [
          `mv ${CONFIG_FILES.map(f => `${configurationDirectory}/${f}`).join(" ")} ${tempDirectory}`,
          `rm -rf ${configurationDirectory}/*`,
          `mv ${CONFIG_FILES.map(f => `${tempDirectory}/${f}`).join(" ")} ${configurationDirectory}`
        ];
        const clearResult = await Code4i.runShellCommand(clearCommand.join(" && "));
        if (clearResult.code === 0) {
          vscode.window.showInformationMessage(l10n.t("ARCAD Server {0} configuration area was successfully cleared.", server.name));
          return true;
        }
        else {
          vscode.window.showErrorMessage(l10n.t("Failed to clear {0} configuration area {0}: {1}", server.name, clearResult.stderr));
          return false;
        }
      });
    });
  }

  export async function clearLogs(server: AFSServer) {
    return await vscode.window.withProgress({ title: l10n.t("Clearing {0} logs...", server.name), location: vscode.ProgressLocation.Notification }, async () => {
      const clearResult = await Code4i.runShellCommand(`rm -rf ${server.ifsPath}/logs/*`);
      if (clearResult.code === 0) {
        vscode.window.showInformationMessage(l10n.t("ARCAD Server {0} logs were successfully cleared.", server.name));
        return true;
      }
      else {
        vscode.window.showErrorMessage(l10n.t("Failed to clear {0} logs: {1}", server.name, clearResult.stderr));
        return false;
      }
    });
  }

  export async function install(installationPackage: vscode.Uri, properties: InstallationProperties) {
    return CommonDAO.install(l10n.t("Installing new ARCAD server"), installationPackage, properties, "install.directory");
  }

  export async function update(installationPackage: vscode.Uri, server: AFSServer) {
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: l10n.t("Updating ARCAD server {0}", server.name), cancellable: false }, async progress => {
      return CommonDAO.withTempDirectory(`${Code4i.getConnection().getConfig().tempDir}/${Code4i.makeId()}`, async workDirectory => {
        progress.report({ message: l10n.t("uploading installation package"), increment: 25 });
        const setupFile = `${workDirectory}/setup.jar`;
        try {
          await Code4i.getConnection().getContent().uploadFiles([{ local: installationPackage, remote: setupFile }]);
        }
        catch (error: any) {
          vscode.window.showErrorMessage(l10n.t("Failed to upload installation package: {0}", error));
          return false;
        }

        progress.report({ message: l10n.t("running update process"), increment: 25 });
        let updateResult = await Code4i.runShellCommand(`java -Dinstall.directory=${server.ifsPath} -jar ${setupFile} --unattended`, workDirectory);
        if (updateResult.code === 0) {
          progress.report({ message: l10n.t("running database update process"), increment: 25 });
          let updateResult = await Code4i.runShellCommand(`dbupdate.sh`, `${server.ifsPath}/tools`);
          if (updateResult.code === 0) {
            vscode.window.showInformationMessage(l10n.t("Update process completed!"));
          }
        }

        if (updateResult.code !== 0) {
          progress.report({ increment: 50 });
          vscode.window.showErrorMessage(l10n.t("Update process failed: {0}", updateResult.stderr));
        }

        return updateResult.code === 0;
      });
    });
  }

  export async function selectInstallationPackage() {
    return CommonDAO.selectInstallationPackage(l10n.t("Select an ARCAD Server installation package"));
  }

  export async function get<T>(server: AFSServer, endpoint: string, accept?: string): Promise<T | undefined> {
    const timeout = 2000;
    const host = Code4i.getConnection().currentHost;
    const port = Number(server.configuration.rest?.port);
    const portSSL = Number(server.configuration.rest?.portssl);
    const headers = new AxiosHeaders().setAccept(accept || 'application/json');

    const requests = [];
    if (portSSL) {
      requests.push(axios.get<T>(`https://${host}:${portSSL}${endpoint}`, { headers, timeout }));
    }

    if (port) {
      requests.push(axios.get<T>(`http://${host}:${port}${endpoint}`, { headers, timeout }));
    }

    if (requests.length) {
      try {
        return (await Promise.race(requests)).data;
      }
      catch (error) {
        console.log(error);
      }
    }
  }
}