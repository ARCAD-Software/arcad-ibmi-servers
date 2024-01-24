import vscode, { l10n } from "vscode";
import { Code4i } from "../code4i";
import { JettyServer } from "../types";

export namespace JettyDAO {
  export async function loadJettyServer(library: string): Promise<JettyServer> {
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
        Cross Join Table(QSYS2.GET_JOB_INFO(JOB_NUMBER || '/' || JOB_USER || '/' || JOB_NAME))
      )
      Select * from JOBINFO`));

      return {
        library,
        jobName: String(jettyJob.JOB_NAME).trim(),
        jobUser: String(jettyJob.JOB_USER).trim(),
        jobNumber: String(jettyJob.JOB_NUMBER).trim(),
        running: Boolean(jettyJob.V_JOB_STATUS === '*ACTIVE'),
        jobStatus: jettyJob.V_ACTIVE_JOB_STATUS ? String(jettyJob.V_ACTIVE_JOB_STATUS).trim() : undefined,
      };
    }
    else {
      return {
        library,
        running: false
      };
    }
  }

  export async function startServer(server: JettyServer) {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: server.running ? l10n.t("Restarting Jetty Server {0}...", server.library) : l10n.t("Starting ARCAD Server {0}...", server.library)
    },
      async () => {
        return await Code4i.runCommand(`STRJTYSVR`, server.library);
      });

    if (result.code === 0) {
      return true;
    }
    else {
      if (server.running) {
        vscode.window.showErrorMessage(l10n.t("Failed to restart Jetty Server {0}: {1}", server.library, result.stderr));
      }
      else {
        vscode.window.showErrorMessage(l10n.t("Failed to start Jetty Server {0}: {1}", server.library, result.stderr));
      }
      return false;
    }
  }

  export async function stopServer(server: JettyServer) {
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: l10n.t("Stopping Jetty Server {0}...", server.library) }, async () => {
      return await Code4i.runCommand(`ENDJTYSVR`, server.library);
    });
    if (result.code === 0) {
      return true;
    }
    else {
      vscode.window.showErrorMessage(l10n.t("Failed to stop Jetty Server {0}: {1}", server.library, result.stderr));
      return false;
    }
  }
}