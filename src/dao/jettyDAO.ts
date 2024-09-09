import { basename } from "path";
import vscode, { l10n } from "vscode";
import { Code4i } from "../code4i";
import { InstallationProperties, JettyConfiguration, JettyServer, ServerLocation } from "../types";
import { CommonDAO } from "./commonDAO";

export namespace JettyDAO {
  export async function loadJettyServer(location: ServerLocation | JettyServer): Promise<JettyServer> {
    const library = location.library;
    const ifsPath = "dataArea" in location ? location.dataArea : location.ifsPath;
    const configuration = await loadConfiguration(ifsPath);
    if (await Code4i.checkObject(library, 'JETTY_PID', '*DTAARA')) {
      const [jettyJob] = (await Code4i.runSQL(
        `With JETTYJOB As (
        Select Substring(DATA_AREA_VALUE,1,6) as JOB_NUMBER,
        Substring(DATA_AREA_VALUE,7,10) as JOB_USER,
        Substring(DATA_AREA_VALUE,17,10) as JOB_NAME
        From Table(QSYS2.DATA_AREA_INFO( DATA_AREA_NAME => 'JETTY_PID', DATA_AREA_LIBRARY => '${library}'))
      ),
      JOBINFO As (
        Select * From JETTYJOB 
        Cross Join Table(QSYS2.GET_JOB_INFO(JOB_NUMBER concat '/' concat JOB_USER concat '/' concat JOB_NAME))
      )
      Select * from JOBINFO`));

      return {
        library,
        ifsPath,
        configuration,
        jobName: String(jettyJob.JOB_NAME).trim(),
        jobUser: String(jettyJob.JOB_USER).trim(),
        jobNumber: String(jettyJob.JOB_NUMBER).trim(),
        running: Boolean(jettyJob.V_JOB_STATUS === '*ACTIVE'),
        jobStatus: jettyJob.V_ACTIVE_JOB_STATUS ? String(jettyJob.V_ACTIVE_JOB_STATUS).trim() : undefined,
        subsystem: String(jettyJob.V_SBS_NAME)
      };
    }
    else {
      return {
        library,
        ifsPath,
        configuration,
        running: false
      };
    }
  }

  async function loadConfiguration(ifsPath: string): Promise<JettyConfiguration> {
    const configuration: JettyConfiguration = {};

    const httpContent = await parseConfiguration(`${ifsPath}/start.d/http.ini`);
    configuration.httpPort = Number(httpContent["jetty.http.port"]) || 0;

    const httpsContent = await parseConfiguration(`${ifsPath}/start.d/https.ini`);
    configuration.httpsPort = Number(httpsContent["jetty.ssl.port"]) || 0;
    configuration.keystore = httpsContent["jetty.sslContext.keyStorePath"];

    return configuration;
  }

  async function parseConfiguration(file: string) {
    const config: Record<string, string> = {};
    if (await Code4i.fileExists(file)) {
      (await Code4i.runShellCommand(`cat ${file}`)).stdout
        .split("\n")
        .map(line => line.trim())
        .filter(line => line && !line.startsWith("#") && line.indexOf("=") > -1)
        .map(line => config[line.substring(0, line.indexOf("=")).trim()] = line.substring(line.indexOf("=") + 1));
    }
    return config;
  }

  export async function startServer(server: JettyServer) {
    let result;
    const jettySBSD = await loadJettySBSD(server);
    if(jettySBSD){
      result = await Code4i.runCommand(`STRSBS SBSD(${server.library}/${jettySBSD})`);
      server = await loadJettyServer(server);
    }

    if(!result || !server.running){
      result = await Code4i.runCommand(`STRJTYSVR`, server.library);
    }
    
    return result;
  }

  export async function stopServer(server: JettyServer | ServerLocation) {
    return (await Code4i.runCommand(`ENDJTYSVR`, server.library));
  }

  export async function clearLogs(server: ServerLocation) {
    return await Code4i.runShellCommand(`rm -rf ${server.dataArea}/logs/*`);
  }

  export async function installWARFiles(location: ServerLocation, warFiles: vscode.Uri[]) {
    const ifsPath = location.dataArea;
    return await vscode.window.withProgress({ title: l10n.t("Installing war files"), location: vscode.ProgressLocation.Notification }, async (task) => {
      task.report({ message: l10n.t("stopping"), increment: 20 });
      let result = await stopServer(location);
      if (result.code === 0) {
        task.report({ message: l10n.t("uploading files"), increment: 20 });
        try {
          const remoteLocation = `${ifsPath}/webapps`;
          await Code4i.getConnection().uploadFiles(warFiles.map(local => ({ local, remote: `${remoteLocation}/${basename(local.path)}` })));
        }
        catch (error: any) {
          result.code = -1;
          result.stderr = l10n.t(`Failed to upload war files: {0}`, error);
        }

        if (result.code === 0) {
          task.report({ message: l10n.t("clearing work directory"), increment: 20 });
          result = await Code4i.runShellCommand(`rm -rf ${ifsPath}/work/*`);
        }
      }

      return result;
    });
  }

  export async function selectWARFiles() {
    return (await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'WAR file': ['war'] },
      title: l10n.t("Select a WAR file")

    }));
  }

  export async function listApplications(server: JettyServer) {
    return (await Code4i.listFiles(`${server.ifsPath}/webapps`)).map(file => file.name)
      .filter(file => file.toLocaleLowerCase().endsWith(".war"))
      .map(file => file.replace(".war", ""));
  }

  export async function openConfigurationFile(server: ServerLocation, configFile: string) {
    openFile(server, `/start.d/${configFile}`);
  }

  export async function openLogs(server: ServerLocation, logFile: string) {
    openFile(server, `/logs/${logFile}`, true);
  }

  export async function selectInstallationPackage() {
    return CommonDAO.selectInstallationPackage(l10n.t("Select a Jetty web server installation package"));
  }

  export async function install(installationPackage: vscode.Uri, properties: InstallationProperties) {
    return CommonDAO.install(l10n.t("Installing new Jetty web server"), installationPackage, properties, "install.directory");
  }

  export async function deleteServer(location: ServerLocation){
    const server = await loadJettyServer(location);
    const jettySubsystem = await loadJettySBSD(location);
    if(server.running){
      let serverStopped;
      if(server.subsystem === jettySubsystem){
        serverStopped = await Code4i.runCommand(`ENDSBS SBS(${jettySubsystem}) OPTION(*IMMED)`);
      }
      else{
        serverStopped = await stopServer(server);
      }

      if(serverStopped.code !== 0){
        throw new Error(l10n.t("Could not stop Jetty Server {0}: {1}", server.library, serverStopped.stderr));
      }
    }

    const deleteIFS = await Code4i.runShellCommand(`rm -rf ${server.ifsPath}`);
    if(deleteIFS.code === 0){
      const deleteLibrary = await Code4i.runCommand(`DLTLIB LIB(${server.library})`);
      if(deleteLibrary.code !== 0){
        throw new Error(l10n.t("Could not delete Jetty Server {0} library: {1}", server.library, deleteLibrary.stderr));  
      }
    }
    else{
      throw new Error(l10n.t("Could not delete Jetty Server {0} IFS folder {1}: {2}", server.library, server.ifsPath, deleteIFS.stderr));
    }
  }

  async function loadJettySBSD(location : ServerLocation | JettyServer){
    return (await Code4i.runSQL(`Select OBJNAME From Table(QSYS2.OBJECT_STATISTICS('${location.library}','*SBSD','*ALL')) Fetch first row only`))?.[0].OBJNAME;
  }

  async function openFile(server: ServerLocation, relativePath: string, readonly?: boolean) {
    Code4i.open(`${server.dataArea}/${relativePath}`, { readonly });
  }
}