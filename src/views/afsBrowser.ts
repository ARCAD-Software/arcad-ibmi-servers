import vscode, { l10n } from "vscode";
import { Code4i } from "../code4i";
import { ServerDAO } from "../dao/serverDAO";
import { openEditServerEditor } from "../editors/edit";
import { openShowServerEditor } from "../editors/show";
import { AFSServer, AFSWrapperLocation } from "../types";

class AFSServerBrowser implements vscode.TreeDataProvider<AFSBrowserItem> {
  private readonly emitter = new vscode.EventEmitter<AFSBrowserItem | undefined | null | void>;
  private readonly locations: AFSWrapperLocation[] = [];
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
      if (!this.locations.length) {
        this.locations.push(...await this.findLocations());
      }
      return this.locations.map(location => new AFSWrapperItem(location));
    }
  }

  getParent(element: AFSBrowserItem): vscode.ProviderResult<AFSBrowserItem> {
    return element.parent;
  }

  private async findLocations(): Promise<AFSWrapperLocation[]> {
    return await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: l10n.t("Loading ARCAD servers...")
    },
      async progress => {
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
      });
  }

  reload() {
    this.locations.splice(0, this.locations.length);
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
    return (await ServerDAO.listServers(this.location.library)).map(server => new AFSServerItem(this, server));
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
    this.tooltip = new vscode.MarkdownString(`- ${l10n.t("IFS path")}: ${server.ifsPath}`, false);
    if (server.configuration.rest?.port) {
      this.tooltip.appendMarkdown(`- ${l10n.t("HTTP port")}: ${server.configuration.rest?.port || "-"}\n`);
    }
    if (server.configuration.rest?.portssl) {
      this.tooltip.appendMarkdown(`- ${l10n.t("HTTPs port")}: ${server.configuration.rest?.portssl || "-"}\n`);
    }
    if (server.running) {
      this.tooltip.appendMarkdown(`- ${l10n.t("Job")}: ${server.jobNumber}/${server.jobUser}/${server.jobName}\n`);
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
        title: l10n.t("Start ARCAD Server {0} in debug mode", this.server.name),
        prompt: l10n.t("Enter a debug port number"),
        validateInput: v => {
          debugPort = Number(v);
          if (isNaN(debugPort) || debugPort < 1 || debugPort > 65535) {
            return l10n.t("Debug port must be a number between 1 and 65535");
          }
          else {
            return undefined;
          }
        }
      });
    }

    if (!debug || debugPort) {
      if (await ServerDAO.startServer(this.server)) {
        this.parent?.refresh();
      }
    }
  }

  async stop() {
    if (await ServerDAO.stopServer(this.server)) {
      this.parent?.refresh();
    }
  }

  async clearConfiguration() {
    if (await vscode.window.showWarningMessage(l10n.t("Are you sure you want to clear {0} server configuration area? (server will be stopped)", this.server.name), { modal: true }, l10n.t("Confirm"))) {
      await this.stop();
      await ServerDAO.clearConfiguration(this.server);
    }
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
    const answer = await vscode.window.showWarningMessage(l10n.t("Do you really want to delete ARCAD Server {0}?", this.server.name), { modal: true },
      yes, yesIfs);

    if (answer === yes || answer === yesIfs) {
      if (await ServerDAO.deleteServer(this.server, answer === yesIfs)) {
        this.parent?.refresh();
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
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.open.logs.server", (serverItem: AFSServerItem) => ServerDAO.openLogs(serverItem.server)),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.open.configuration.server", (serverItem: AFSServerItem) => ServerDAO.openConfiguration(serverItem.server)),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.clear.configuration.server", (server: AFSServerItem) => server.clearConfiguration()),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.add.to.ifs.browser.server", (server: AFSServerItem) => server.addToIFSBrowser())
  );

  Code4i.onEvent("connected", () => afsBrowser.reload());
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