import axios, { AxiosHeaders } from "axios";
import vscode, { l10n } from "vscode";
import { Code4i } from "../code4i";
import { AFSServer, InstallationProperties, ServerConfiguration, ServerUpdate } from "../types";

export namespace AFSServerDAO {
  const CONFIG_FILES = ["org.eclipse.equinox.simpleconfigurator", "config.ini", "osgi.cm.ini"];

  export async function listServers(library: string) {
    const rows = (await Code4i.runSQL(`Select * From ${library}.AFSSERVERS ` +
      `Cross Join Table(QSYS2.GET_JOB_INFO(AFS_JOBNUMBER || '/' || AFS_JOBUSER || '/' ||AFS_JOBNAME)) ` +
      `For fetch only`)
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
        jobNumber: String(row.AFS_JOBNUMBER).trim(),
        running: Boolean(row.V_JOB_STATUS === '*ACTIVE'),
        jobStatus: row.V_ACTIVE_JOB_STATUS ? String(row.V_ACTIVE_JOB_STATUS).trim() : undefined,
        configuration: await loadConfiguration(String(row.AFS_IFSPATH).trim())
      } as AFSServer);
    }
    return servers;
  }

  async function loadConfiguration(ifsPath: string): Promise<ServerConfiguration> {
    const config: ServerConfiguration = {};
    if ((await Code4i.runShellCommand(`[ -d ${ifsPath} ]`)).code === 0) {
      const configFile = `${ifsPath}/configuration/osgi.cm.ini`;
      if ((await Code4i.runShellCommand(`[ -f ${configFile} ]`)).code === 0) {
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

  export async function changeServer(server: AFSServer, payload: ServerUpdate) {
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
      command.push(`JAVAHOME('${payload.javaHome})'`);
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
      return withTempDirectory(`${Code4i.getConnection().config?.tempDir}/arcadserver_${server.name}`, async tempDirectory => {
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
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: l10n.t("Installing new ARCAD server"), cancellable: false }, async progress => {
      return withTempDirectory(`${Code4i.getConnection().config?.tempDir}/${Code4i.makeId()}`, async workDirectory => {
        progress.report({ message: l10n.t("uploading installation package"), increment: 33 });
        const setupFile = `${workDirectory}/setup.jar`;
        try {
          await Code4i.getConnection().uploadFiles([{ local: installationPackage, remote: setupFile }]);
        }
        catch (error: any) {
          vscode.window.showErrorMessage(l10n.t("Failed to upload installation package: {0}", error));
          return false;
        }
        const installationProperties = Array.from(toInstallerProperties(properties));
        progress.report({ message: l10n.t("running installation process"), increment: 33 });
        const installResult = await Code4i.runShellCommand(`java ${installationProperties.map(([key, value]) => `-D${key}=${value}`).join(" ")} -jar ${setupFile} --unattended && echo "${installationProperties.map(([key, value]) => `${key}=${value}`).join("\n")}" > $(ls ${properties.ifsPath}/*.properties)`, workDirectory);
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

  export async function update(installationPackage: vscode.Uri, server: AFSServer) {
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: l10n.t("Updating ARCAD server {0}", server.name), cancellable: false }, async progress => {
      return withTempDirectory(`${Code4i.getConnection().config?.tempDir}/${Code4i.makeId()}`, async workDirectory => {
        progress.report({ message: l10n.t("uploading installation package"), increment: 25 });
        const setupFile = `${workDirectory}/setup.jar`;
        try {
          await Code4i.getConnection().uploadFiles([{ local: installationPackage, remote: setupFile }]);
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
    return (await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'Installation package': ['jar'] },
      title: l10n.t("Select an ARCAD Server installation package")

    }))?.[0];
  }

  async function withTempDirectory(directory: string, process: (directory: string) => Promise<boolean>) {
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

  function toInstallerProperties(properties: InstallationProperties) {
    const props = new Map<string, string>();
    props.set("install.directory", properties.ifsPath);
    props.set("afs.user", properties.user);
    props.set("afs.https.port", "0");

    if (properties.instance) {
      props.set("afs.starter.instance", properties.instance);
    }

    if (properties.library) {
      props.set("afs.starter.library", properties.library);
    }

    if (properties.iasp) {
      props.set("afs.starter.iasp", properties.iasp);
    }

    if (properties.port) {
      props.set("afs.http.port", String(properties.port));
    }

    if (properties.jobqName) {
      props.set("arcad.jobq", properties.jobqName);
    }

    if (properties.jobqLibrary) {
      props.set("arcad.jobq.library", properties.jobqLibrary);
    }

    return props;
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