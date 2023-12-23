import vscode, { l10n } from "vscode";
import { Code4i } from "../code4i";
import { openEditServerEditor } from "../editors/edit";
import { openShowServerEditor } from "../editors/show";
import { Configuration } from "../extension";
import { AFSServer, AFSWrapperLocation } from "../types";

class AFSServerBrowser implements vscode.TreeDataProvider<AFSBrowserItem> {
  private readonly emitter = new vscode.EventEmitter<AFSBrowserItem | undefined | null | void>;
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(target?: AFSBrowserItem) {
    this.emitter.fire(target);
  }

  getTreeItem(element: AFSBrowserItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
    return element;
  }

  async getChildren(element?: AFSBrowserItem) {
    if (element) {
      return element.getChildren?.();
    }
    else {
      return (await this.load(false)).locations.map(location => new AFSWrapperItem(location));
    }
  }

  getParent(element: AFSBrowserItem): vscode.ProviderResult<AFSBrowserItem> {
    return element.parent;
  }

  private async findLocations(): Promise<AFSWrapperLocation[]> {
    const rows = await Code4i.runSQL(
      `Select OBJLIB, IASP_NUMBER, DATA_AREA_VALUE ` +
      `From Table(QSYS2.OBJECT_STATISTICS('*ALL','*DTAARA','AFSVERSION')) ` +
      `Cross Join Table(QSYS2.DATA_AREA_INFO( DATA_AREA_NAME => OBJNAME, DATA_AREA_LIBRARY => OBJLIB))`
    );
    return rows.map(row => ({
      library: String(row.OBJLIB).trim(),
      iasp: Number(row.IASP_NUMBER || 0),
      version: String(row.DATA_AREA_VALUE).trim(),
    })) as AFSWrapperLocation[];
  }

  private async load(reload: boolean) {
    const wrappers = await Configuration.getWrappers();
    if (!wrappers.locations.length || reload) {
      wrappers.locations = await this.findLocations();
      await Configuration.updateWrappers(wrappers);
    }
    return wrappers;
  }

  async reload() {
    await this.load(true);
    this.refresh();
  }
}

type Icon = { name: string, color?: string };

type BrowserItemParameters = {
  icon?: Icon
  state?: vscode.TreeItemCollapsibleState
  parent?: AFSBrowserItem
};

class AFSBrowserItem extends vscode.TreeItem {
  constructor(label: string, readonly params?: BrowserItemParameters) {
    super(label, params?.state);
    this.iconPath = params?.icon ? new vscode.ThemeIcon(params.icon.name, params.icon.color ? new vscode.ThemeColor(params.icon.color) : undefined) : undefined;
  }

  get parent() {
    return this.params?.parent;
  }

  getChildren?(): vscode.ProviderResult<AFSBrowserItem[]>;

  refresh() {
    vscode.commands.executeCommand("arcad-afs-for-ibm-i.refresh", this);
  }
}

class AFSWrapperItem extends AFSBrowserItem {
  constructor(readonly location: AFSWrapperLocation) {
    super(location.library, { icon: { name: "server" }, state: vscode.TreeItemCollapsibleState.Collapsed });
    this.description = location.version;
  }

  async getChildren() {
    return (await Code4i.runSQL(`Select * From ${this.location.library}.AFSSERVERS ` +
      `Cross Join Table(QSYS2.GET_JOB_INFO(AFS_JOBNUMBER || '/' || AFS_JOBUSER || '/' ||AFS_JOBNAME)) ` +
      `For fetch only`)
    )
      .map(row => ({
        library: this.location.library,
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
        jobStatus: row.V_ACTIVE_JOB_STATUS ? String(row.V_ACTIVE_JOB_STATUS).trim() : undefined
      }) as AFSServer)
      .map(server => new AFSServerItem(this, server));
  }
}

class AFSServerItem extends AFSBrowserItem {
  constructor(parent: AFSWrapperItem, readonly server: AFSServer) {
    super(server.name, {
      parent,
      icon: getServerIcon(server),
      state: vscode.TreeItemCollapsibleState.None
    });
    this.contextValue = `afsserver_${server.running ? "run" : ""}`;
    this.description = server.running ? l10n.t("Running") : l10n.t("Stopped");
    if (server.running) {
      this.tooltip = this.tooltip = new vscode.MarkdownString(`- ${l10n.t("Job")}: ${server.jobNumber}/${server.jobUser}/${server.jobName}\n`, false)
        .appendMarkdown(`- ${l10n.t("IFS path")}: ${server.ifsPath}`);
    }

    this.command = {
      title: "",
      command: "arcad-afs-for-ibm-i.show.server",
      arguments: [this]
    };
  }

  async start(debug?: boolean) {
    let debugPort = 0;
    if (debug) {
      await vscode.window.showInputBox({
        title: l10n.t("Start AFS Server {0} in debug mode", this.server.name),
        prompt: l10n.t("Enter a debug port number"),
        validateInput: v => {
          debugPort = Number(v);
          if(isNaN(debugPort) || debugPort < 1 || debugPort > 65535){
            return l10n.t("Debug port must be a number between 1 and 65535");
          }
          else{
            return undefined;
          }          
        }
      });
    }

    if (!debug || debugPort) {
      const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: this.server.running ? l10n.t("Restarting AFS Server {0}...", this.server.name) : l10n.t("Starting AFS Server {0}...", this.server.name)
      },
        async progress => {
          return await Code4i.runCommand(`${this.server.library}/STRAFSSVR INSTANCE(${this.server.name}) DBGPORT(${debugPort})`);
        });

      if (result.code === 0) {
        this.parent?.refresh();
      }
      else {
        if (this.server.running) {
          vscode.window.showErrorMessage(l10n.t("Failed to restart AFS server {0}: {1}", this.server.name, result.stderr));
        }
        else {
          vscode.window.showErrorMessage(l10n.t("Failed to start AFS server {0}: {1}", this.server.name, result.stderr));
        }
      }
    }
  }

  async stop() {
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: l10n.t("Stopping AFS Server {0}...", this.server.name) }, async progress => {
      return await Code4i.runCommand(`${this.server.library}/ENDAFSSVR INSTANCE(${this.server.name})`);
    });
    if (result.code === 0) {
      this.parent?.refresh();
    }
    else {
      vscode.window.showErrorMessage(l10n.t("Failed to stop AFS server {0}: {1}", this.server.name, result.stderr));
    }
  }

  openLogs() {
    Code4i.open(`${this.server.ifsPath}/logs/server.log`, { readonly: true });
  }

  openConfiguration() {
    Code4i.open(`${this.server.ifsPath}/configuration/osgi.cm.ini`);
  }

  addToIFSBrowser() {
    vscode.commands.executeCommand("code-for-ibmi.addIFSShortcut", { path: this.server.ifsPath });
  }

  show() {
    openShowServerEditor(this.server);
  }

  edit() {
    openEditServerEditor(this.server, restart => {
      this.parent?.refresh();
      if (restart) {
        this.start();
      }
    });
  }

  async delete() {
    const yes = l10n.t("Yes");
    const yesIfs = l10n.t("Yes, including IFS files");
    const answer = await vscode.window.showWarningMessage(l10n.t("Do you really want to delete AFS server {0}?", this.server.name), { modal: true },
      yes, yesIfs);

    if (answer === yes || answer === yesIfs) {
      const result = await Code4i.runCommand(`${this.server.library}/DLTAFSSVR INSTANCE(${this.server.name}) DELETE(${answer === yesIfs ? '*YES' : '*NO'})`);
      if (result.code === 0) {
        if (this.server.running) {
          vscode.window.showInformationMessage(l10n.t("AFS server {0} successfully stopped and deleted.", this.server.name));
        }
        else {
          vscode.window.showInformationMessage(l10n.t("AFS server {0} successfully deleted.", this.server.name));
        }
        this.parent?.refresh();
      }
      else {
        vscode.window.showErrorMessage(l10n.t("Failed to delete AFS server {0}: {1}", this.server.name, result.stdout));
      }
    }
  }
}

export function initializeAFSBrowser(context: vscode.ExtensionContext) {
  const afsBrowser = new AFSServerBrowser();
  const afsBrowserTreeViewer = vscode.window.createTreeView(
    `afsServerBrowser`, {
    treeDataProvider: afsBrowser,
    showCollapseAll: true
  });

  context.subscriptions.push(
    afsBrowserTreeViewer,
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.refresh", (item?: AFSBrowserItem) => afsBrowser.refresh(item)),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.reload", () => afsBrowser.reload()),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.start.server", (server: AFSServerItem) => server.start()),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.debug.server", (server: AFSServerItem) => server.start(true)),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.stop.server", (server: AFSServerItem) => server.stop()),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.show.server", (server: AFSServerItem) => server.show()),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.edit.server", (server: AFSServerItem) => server.edit()),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.delete.server", (server: AFSServerItem) => server.delete()),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.open.logs.server", (server: AFSServerItem) => server.openLogs()),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.open.configuration.server", (server: AFSServerItem) => server.openConfiguration()),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.add.to.ifs.browser.server", (server: AFSServerItem) => server.addToIFSBrowser())
  );

  Code4i.onEvent("connected", () => afsBrowser.refresh());
}

function getServerIcon(server: AFSServer): Icon {
  if (server.running) {
    if (server.jobStatus === "MSGW") {
      return { name: "warning", color: "notificationsWarningIcon.foreground" };
    }
    else {
      return { name: "gear~spin", color: "testing.iconPassed" };
    }
  }
  else {
    return { name: "gear" };
  }
}