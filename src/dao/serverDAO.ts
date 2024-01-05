import vscode, { l10n } from "vscode";
import { Code4i } from "../code4i";
import { AFSServer, ServerConfiguration, ServerUpdate } from "../types";

export namespace ServerDAO {
  const CONFIG_FILES = ["org.eclipse.equinox.simpleconfigurator", "config.ini", "osgi.cm.ini"];

  export async function listServers(library: string) {
    return Promise.all((await Code4i.runSQL(`Select * From ${library}.AFSSERVERS ` +
      `Cross Join Table(QSYS2.GET_JOB_INFO(AFS_JOBNUMBER || '/' || AFS_JOBUSER || '/' ||AFS_JOBNAME)) ` +
      `For fetch only`)
    )
      .map(async row => ({
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
      }) as AFSServer));
  }

  async function loadConfiguration(ifsPath: string): Promise<ServerConfiguration> {
    const config: ServerConfiguration = {};

    let section;
    for (const line of (await Code4i.runShellCommand(`cat ${ifsPath}/configuration/osgi.cm.ini`)).stdout.split("\n").map(line => line.trim())) {
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

  export async function updateServer(server: AFSServer, payload: ServerUpdate) {
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
    Code4i.open(`${server.ifsPath}/configuration/osgi.cm.ini`);
  }

  export async function clearConfiguration(server: AFSServer) {
    const configurationDirectory = `${server.ifsPath}/configuration`;
    const tempDirectory = `${Code4i.getConnection().config?.tempDir}/arcadserver_${server.name}`;
    const prepareTempDirectory = await Code4i.runShellCommand(`rm -rf ${tempDirectory} && mkdir -p ${tempDirectory}`);
    if (prepareTempDirectory.code === 0) {
      try {
        const clearCommand = [
          `mv ${CONFIG_FILES.map(f => `${configurationDirectory}/${f}`).join(" ")} ${tempDirectory}`,
          `rm -rf ${configurationDirectory}/*`,
          `mv ${CONFIG_FILES.map(f => `${tempDirectory}/${f}`).join(" ")} ${configurationDirectory}`
        ];
        const clearResult = await Code4i.runShellCommand(clearCommand.join(" && "));
        if (clearResult.code === 0) {
          vscode.window.showInformationMessage(l10n.t("ARCAD Server {0} configuration area was successfully cleared. Please restart it.", server.name));
        }
        else {
          vscode.window.showErrorMessage(l10n.t("Failed to clear {0} configuration area {0}: {1}", server.name, clearResult.stderr));
        }
      }
      finally {
        await Code4i.runShellCommand(`rm -rf ${tempDirectory}`);
      }
    }
    else {
      vscode.window.showErrorMessage(l10n.t("Failed to create temporary directory {0}: {1}", tempDirectory, prepareTempDirectory.stderr));
    }
  }
}