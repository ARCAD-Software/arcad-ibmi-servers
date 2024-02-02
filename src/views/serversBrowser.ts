import { basename } from "path";
import vscode, { l10n } from "vscode";
import { Code4i } from "../code4i";
import { AFSServerDAO } from "../dao/afsDAO";
import { ArcadDAO } from "../dao/arcadDAO";
import { JettyDAO } from "../dao/jettyDAO";
import { openEditAFSServerEditor } from "../editors/afs/edit";
import { openInstallAFSEditor } from "../editors/afs/install";
import { openShowAFSServerEditor } from "../editors/afs/show";
import { openShowArcadInstanceEditor } from "../editors/arcad/show";
import { openInstallJettyEditor } from "../editors/jetty/install";
import { openShowJettyServerEditor } from "../editors/jetty/show";
import { AFSServer, ArcadInstance, JettyServer, ServerLocation } from "../types";

class AFSServerBrowser implements vscode.TreeDataProvider<ServerBrowserItem> {
  private readonly emitter = new vscode.EventEmitter<ServerBrowserItem | undefined | null | void>;
  private readonly locations: ServerLocation[] = [];
  private readonly arcadInstancesNode = new ArcadInstancesItem();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor() {
    Code4i.onEvent("connected", () => this.reload());
  }

  refresh(target?: ServerBrowserItem) {
    this.emitter.fire(target);
  }

  getTreeItem(element: ServerBrowserItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
    return element;
  }

  async getChildren(element?: ServerBrowserItem) {
    if (element) {
      return element.getChildren?.();
    }
    else {
      if (!this.locations.length) {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: l10n.t("Loading ARCAD servers...")
        },
          async () => this.locations.push(...await findLocations()));
      }

      const items: ServerBrowserItem[] = [this.arcadInstancesNode];

      for (const location of this.locations) {
        switch (location.type) {
          case "Jetty":
            items.push(new JettyWrapperItem(location));
            break;
          case "AFS":
          default:
            items.push(new AFSWrapperItem(location));
            break;
        }
      }

      return items;
    }
  }

  getParent(element: ServerBrowserItem): vscode.ProviderResult<ServerBrowserItem> {
    return element.parent;
  }

  reload() {
    this.locations.splice(0, this.locations.length);
    this.arcadInstancesNode.reload();
    this.refresh();
  }
}

type Icon = { name: string, color?: string };

type BrowserItemParameters = {
  icon?: Icon
  state?: vscode.TreeItemCollapsibleState
  parent?: ServerBrowserItem
};

class ServerBrowserItem extends vscode.TreeItem {
  constructor(label: string, readonly params?: BrowserItemParameters) {
    super(label, params?.state);
    this.iconPath = params?.icon ? new vscode.ThemeIcon(params.icon.name, params.icon.color ? new vscode.ThemeColor(params.icon.color) : undefined) : undefined;
  }

  get parent() {
    return this.params?.parent;
  }

  getChildren?(): vscode.ProviderResult<ServerBrowserItem[]>;

  refresh() {
    vscode.commands.executeCommand("arcad-afs-for-ibm-i.refresh", this);
  }
}

class ArcadInstancesItem extends ServerBrowserItem {
  private readonly instances: ArcadInstance[] = [];

  constructor() {
    super(l10n.t("ARCAD instances"), { icon: { name: "home" }, state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = "arcadinstances";
  }

  async getChildren() {
    if (!this.instances.length) {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: l10n.t("Loading ARCAD instances...")
      }, async () => this.instances.push(...await ArcadDAO.loadInstances()));
    }

    return this.instances.map(instance => new ArcadInstanceItem(this, instance));
  }

  reload() {
    this.instances.splice(0, this.instances.length);
  }
}

class ArcadInstanceItem extends ServerBrowserItem {
  constructor(parent: ArcadInstancesItem, readonly instance: ArcadInstance) {
    super(instance.code, { icon: { name: "circle-filled" }, state: vscode.TreeItemCollapsibleState.None, parent });
    this.contextValue = "arcadinstance";
    this.description = `${instance.version} - ${instance.text}`;
    this.tooltip = new vscode.MarkdownString(`${instance.text}\n`)
      .appendMarkdown(`- ${l10n.t("Production library")}: ${instance.library}\n`)
      .appendMarkdown(`- iASP: ${instance.iasp || '*SYSBAS'}`);

    this.command = {
      title: "",
      command: "arcad-afs-for-ibm-i.show.server",
      arguments: [this]
    };
  }

  show() {
    openShowArcadInstanceEditor(this.instance);
  }
}

class JettyWrapperItem extends ServerBrowserItem {
  constructor(readonly location: ServerLocation) {
    super(location.library, { icon: { name: "globe" }, state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = "jettywrapper";
    this.description = location.dataArea;
  }

  async getChildren() {
    return [
      new JettyJobItem(this, await JettyDAO.loadJettyServer(this.location))
    ];
  }

  addToIFSBrowser() {
    vscode.commands.executeCommand("code-for-ibmi.addIFSShortcut", { path: this.location.dataArea });
  }

  async clearLogs() {
    if (await vscode.window.showWarningMessage(l10n.t("Are you sure you want to clear {0} Jetty logs? (server has to be stopped)", this.location.library), { modal: true }, l10n.t("Confirm"))) {
      return await vscode.window.withProgress({ title: l10n.t("Clearing Jetty {0} logs", this.location.library), location: vscode.ProgressLocation.Notification }, async (task) => {
        task.report({ message: l10n.t("stopping"), increment: 33 });
        const stopResult = await JettyDAO.stopServer(this.location);
        if (stopResult.code === 0) {
          task.report({ message: l10n.t("clearing logs"), increment: 33 });
          const clearResult = await JettyDAO.clearLogs(this.location);
          if (clearResult.code === 0) {
            this.refresh();
          }
          else {
            vscode.window.showErrorMessage(l10n.t("Failed to clear Jetty server {0} logs: {1}", this.location.library, clearResult.stderr));
          }
        }
        else {
          vscode.window.showErrorMessage(l10n.t("Failed to stop Jetty server {0}: {1}", this.location.library, stopResult.stderr));
        }
      });
    }
  }

  async delete() {
    if (await vscode.window.showWarningMessage(l10n.t("Do you really want to delete Jetty Server {0}?", this.location.library), { modal: true }, l10n.t("Yes"))) {
      vscode.window.withProgress({ title: l10n.t("Deleting Jetty Server {0}...", this.location.library), location: vscode.ProgressLocation.Notification }, async () => {
        await JettyDAO.deleteServer(this.location);
        vscode.commands.executeCommand("arcad-afs-for-ibm-i.reload");
      });
    }
  }
}

class JettyJobItem extends ServerBrowserItem {
  constructor(parent: JettyWrapperItem, readonly server: JettyServer) {
    super(server.running ? `${server.jobNumber}/${server.jobUser}/${server.jobName}` : l10n.t("No job running"), { parent, icon: getJettyServerIcon(server) });
    this.contextValue = `jettyjob${server.running ? "_run" : ""}`;
    this.description = server.jobStatus;
    this.tooltip = new vscode.MarkdownString(``, false);

    if (server.configuration.httpPort) {
      this.tooltip.appendMarkdown(`- ${l10n.t("HTTP")}: ${server.configuration.httpPort}`);
    }

    if (server.configuration.httpsPort) {
      this.tooltip.appendMarkdown(`${this.tooltip.value.length ? '\n' : ''}- ${l10n.t("HTTPS")}: ${server.configuration.httpsPort}`);
    }

    this.command = {
      title: "",
      command: "arcad-afs-for-ibm-i.show.server",
      arguments: [this]
    };
  }

  async start() {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: this.server.running ? l10n.t("Restarting Jetty Server {0}...", this.server.library) : l10n.t("Starting Jetty Server {0}...", this.server.library)
    },
      async () => {
        const result = await JettyDAO.startServer(this.server);
        if (result.code === 0) {
          this.parent?.refresh();
        }
        else {
          vscode.window.showErrorMessage(this.server.running ? l10n.t("Failed to restart Jetty Server {0}: {1}", this.server.library, result.stderr) :
            l10n.t("Failed to start Jetty Server {0}: {1}", this.server.library, result.stderr));
        }
      });
  }

  async stop() {
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: l10n.t("Stopping Jetty Server {0}...", this.server.library) },
      async () => await JettyDAO.stopServer(this.server));
    if (result.code === 0) {
      this.parent?.refresh();
    }
    else {
      vscode.window.showErrorMessage(l10n.t("Failed to stop Jetty Server {0}: {1}", this.server.library, result.stderr));
    }
  }

  show() {
    openShowJettyServerEditor(this.server);
  }

  async openBrowser() {
    const applications = await JettyDAO.listApplications(this.server);
    const selected = (await vscode.window.showQuickPick([
      { label: '/', description: 'Root' },
      ...applications.map(app => ({ label: app }))
    ],
      { title: l10n.t("Select an application") }))?.label;

    if (selected) {
      const scheme = `http${this.server.configuration.httpsPort ? 's' : ''}`;
      const port = this.server.configuration.httpsPort || this.server.configuration.httpPort;
      vscode.commands.executeCommand("vscode.open", vscode.Uri.from({
        scheme,
        authority: `${Code4i.getConnection().currentHost}:${port}`,
        path: selected.endsWith('/') ? selected : `${selected}/`
      }));
    }
  }
}

class AFSWrapperItem extends ServerBrowserItem {
  constructor(readonly location: ServerLocation) {
    super(location.library, { icon: { name: "server" }, state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = "afswrapper";
    this.description = location.dataArea;
  }

  async getChildren() {
    return (await AFSServerDAO.listServers(this.location.library)).map(server => new AFSServerItem(this, server));
  }
}

class AFSServerItem extends ServerBrowserItem {
  constructor(parent: AFSWrapperItem, readonly server: AFSServer) {
    super(server.name, {
      parent,
      icon: getAFSServerIcon(server),
      state: vscode.TreeItemCollapsibleState.None
    });
    this.contextValue = `afsserver${server.running ? "_run" : ""}`;

    if (server.configuration.error) {
      switch (server.configuration.error) {
        case "noconfig":
          this.description = l10n.t("Configuration file not found");
          break;
        case "nofolder":
          this.description = l10n.t("Installation folder not found");
          break;
      }
    }
    else if (!server.configuration.rest) {
      this.description = l10n.t("Configuration file is incomplete");
    }
    else {
      this.description = server.running ? l10n.t("Running") : l10n.t("Stopped");
    }

    this.tooltip = new vscode.MarkdownString(`- ${l10n.t("IFS path")}: ${server.ifsPath}\n`, false);
    if (server.configuration.rest?.port) {
      this.tooltip.appendMarkdown(`- ${l10n.t("HTTP port")}: ${server.configuration.rest?.port || "-"}\n`);
    }
    if (server.configuration.rest?.portssl) {
      this.tooltip.appendMarkdown(`- ${l10n.t("HTTPS port")}: ${server.configuration.rest?.portssl || "-"}\n`);
    }
    if (server.running) {
      this.tooltip.appendMarkdown(`- ${l10n.t("Job")}: ${server.jobNumber}/${server.jobUser}/${server.jobName}`);
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
      if (await AFSServerDAO.startServer(this.server, debugPort)) {
        this.parent?.refresh();
      }
    }
  }

  async stop() {
    if (await AFSServerDAO.stopServer(this.server)) {
      this.parent?.refresh();
    }
  }

  async clearConfiguration() {
    if (await vscode.window.showWarningMessage(l10n.t("Are you sure you want to clear {0} server configuration area? (server has to be stopped)", this.server.name), { modal: true }, l10n.t("Confirm"))) {
      await this.stop();
      await AFSServerDAO.clearConfiguration(this.server);
    }
  }

  async clearLogs() {
    if (await vscode.window.showWarningMessage(l10n.t("Are you sure you want to clear {0} server logs? (server has to be stopped)", this.server.name), { modal: true }, l10n.t("Confirm"))) {
      await this.stop();
      await AFSServerDAO.clearLogs(this.server);
    }
  }

  addToIFSBrowser() {
    vscode.commands.executeCommand("code-for-ibmi.addIFSShortcut", { path: this.server.ifsPath });
  }

  show() {
    openShowAFSServerEditor(this.server);
  }

  edit() {
    openEditAFSServerEditor(this.server, restart => {
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
      vscode.window.withProgress({ title: l10n.t("Deleting ARCAD Server {0}...", this.server.name), location: vscode.ProgressLocation.Notification }, async () => {
        if (await AFSServerDAO.deleteServer(this.server, answer === yesIfs)) {
          vscode.commands.executeCommand("arcad-afs-for-ibm-i.reload");
        }
      });
    }
  }
}

class ServerBrowserDragAndDropController implements vscode.TreeDragAndDropController<ServerBrowserItem> {
  readonly dropMimeTypes = ["text/uri-list"];
  readonly dragMimeTypes = [];

  async handleDrop(target: ServerBrowserItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken) {
    const explorerItems = dataTransfer.get("text/uri-list");
    if (explorerItems && explorerItems.value) {
      const droppedFiles = (await explorerItems.asString()).split("\r\n").map(uri => vscode.Uri.parse(uri));
      const droppedFile = droppedFiles[0];
      const fileStat = await vscode.workspace.fs.stat(droppedFile);
      const fileName = basename(droppedFile.path).toLocaleLowerCase();
      const jettyPackage = fileName.includes("webconsole") || fileName.includes("webservices");
      if (fileStat.type === vscode.FileType.File) {
        if (fileName.endsWith(".jar")) {
          if (jettyPackage) {
            if (!target && await openInstallJettyEditor(droppedFile)) {
              vscode.commands.executeCommand("arcad-afs-for-ibm-i.reload");
            }
          }
          else if (!target || target instanceof AFSWrapperItem) {
            installServer(target, droppedFile);
          }
          else if (target instanceof AFSServerItem && await vscode.window.showInformationMessage(l10n.t(`Do you want to update ARCAD server {0} using the package {1}?`, target.server.name, droppedFile.path.substring(droppedFile.path.lastIndexOf('/') + 1)), { modal: true }, l10n.t("Update"))) {
            updateServer(target, droppedFile);
          }
        }
        else if (target instanceof JettyWrapperItem || target instanceof JettyJobItem) {
          installWAR(target, droppedFiles);
        }
      }
    }
  }
}

export function initializeAFSBrowser(context: vscode.ExtensionContext) {
  const afsBrowser = new AFSServerBrowser();
  const afsBrowserTreeViewer = vscode.window.createTreeView(
    `afsServerBrowser`, {
    treeDataProvider: afsBrowser,
    showCollapseAll: true,
    dragAndDropController: new ServerBrowserDragAndDropController()
  });

  context.subscriptions.push(
    afsBrowserTreeViewer,
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.refresh", (item?: ServerBrowserItem) => afsBrowser.refresh(item)),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.reload", () => afsBrowser.reload()),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.start.server", (server: AFSServerItem | JettyJobItem) => server.start()),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.debug.server", (server: AFSServerItem) => server.start(true)),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.stop.server", (server: AFSServerItem | JettyJobItem) => server.stop()),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.show.server", (server: AFSServerItem | JettyJobItem | ArcadInstanceItem) => server.show()),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.edit.server", (server: AFSServerItem) => server.edit()),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.delete.server", (server: AFSServerItem | JettyWrapperItem) => server.delete()),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.open.logs.server", async (serverItem: AFSServerItem | JettyWrapperItem) => {
      if (serverItem instanceof AFSServerItem) {
        AFSServerDAO.openLogs(serverItem.server);
      }
      else {
        const selected = (await vscode.window.showQuickPick(
          ((await Code4i.listFiles(`${serverItem.location.dataArea}/logs`))
            .filter(f => f.name.toLocaleLowerCase().endsWith('.log'))
            .sort((f1, f2) => f2.modified && f1.modified ? f2.modified?.getTime() - f1.modified?.getTime() : f2.name.localeCompare(f1.name))
            .map(f => ({ label: f.name })))
          , { title: l10n.t("Select a log file to open") }))?.label;
        if (selected) {
          JettyDAO.openLogs(serverItem.location, selected);
        }
      }
    }),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.open.configuration.server", (serverItem: AFSServerItem) => AFSServerDAO.openConfiguration(serverItem.server)),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.clear.configuration.server", (server: AFSServerItem) => server.clearConfiguration()),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.clear.logs.server", (server: AFSServerItem | JettyWrapperItem) => server.clearLogs()),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.add.to.ifs.browser.server", (server: AFSServerItem | JettyWrapperItem) => server.addToIFSBrowser()),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.install", install),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.install.server", installServer),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.update.server", updateServer),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.install.war", installWAR),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.open.browser", (node: JettyJobItem) => node.openBrowser()),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.open.config.http", (node: JettyWrapperItem) => JettyDAO.openConfigurationFile(node.location, "http.ini")),
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.open.config.https", (node: JettyWrapperItem) => JettyDAO.openConfigurationFile(node.location, "https.ini"))
  );
}

function getAFSServerIcon(server: AFSServer): Icon {
  if (server.running) {
    if (server.jobStatus === "MSGW") {
      return { name: "warning", color: "notificationsWarningIcon.foreground" };
    }
    else {
      return { name: "gear~spin", color: "testing.iconPassed" };
    }
  }
  else {
    if (server.configuration.error) {
      return { name: "warning", color: "notificationsWarningIcon.foreground" };
    }
    else {
      return { name: "gear" };
    }
  }
}

function getJettyServerIcon(server: JettyServer): Icon {
  if (server.running) {
    return { name: "gear~spin", color: "testing.iconPassed" };
  }
  else {
    return { name: "gear" };
  }
}

async function install() {
  const selected = (await vscode.window.showQuickPick([
    { label: "AFS Server", description: l10n.t("AFS framework based server") },
    { label: "Jetty", description: l10n.t("Jetty web server") }
  ]))?.label;
  if (selected) {
    if (selected === "Jetty") {
      const installPackage = await JettyDAO.selectInstallationPackage();
      if (installPackage && await openInstallJettyEditor(installPackage)) {
        vscode.commands.executeCommand("arcad-afs-for-ibm-i.reload");
      }
    }
    else {
      installServer();
    }
  }
}

async function installServer(wrapper?: AFSWrapperItem, installationPackage?: vscode.Uri) {
  await openInstallAFSEditor(wrapper?.location.library, installationPackage, () => wrapper ? wrapper.refresh() : vscode.commands.executeCommand("arcad-afs-for-ibm-i.reload"));
}

async function updateServer(serverItem: AFSServerItem, installationPackage?: vscode.Uri) {
  installationPackage = installationPackage || await AFSServerDAO.selectInstallationPackage();
  if (installationPackage && installationPackage.path.toLowerCase().endsWith(".jar") && await AFSServerDAO.update(installationPackage, serverItem.server)) {
    serverItem.refresh();
  }
}

async function installWAR(jetty: JettyWrapperItem | JettyJobItem, warFiles?: vscode.Uri[]) {
  warFiles = warFiles || await JettyDAO.selectWARFiles();
  if (warFiles && warFiles.every(file => file.path.toLowerCase().endsWith(".war")) &&
    await vscode.window.showInformationMessage(l10n.t(`Do you really wish to install the following war files (Jetty will be stopped)?`),
      { detail: warFiles.map(f => `- ${basename(f.path)}`).join("\n"), modal: true },
      l10n.t("Proceed"))) {
    if (jetty instanceof JettyWrapperItem) {
      await JettyDAO.installWARFiles(jetty.location, warFiles);
      jetty.refresh();
    }
    else if (jetty.parent instanceof JettyWrapperItem) {
      await JettyDAO.installWARFiles(jetty.parent.location, warFiles);
      jetty.parent.refresh();
    }
  }
}

async function findLocations(): Promise<ServerLocation[]> {
  const rows = await Code4i.runSQL(
    `Select OBJLIB, IASP_NUMBER, DATA_AREA_VALUE, 'AFS' as TYPE ` +
    `From Table(QSYS2.OBJECT_STATISTICS('*ALL','*DTAARA','AFSVERSION')) ` +
    `Cross Join Table(QSYS2.DATA_AREA_INFO( DATA_AREA_NAME => OBJNAME, DATA_AREA_LIBRARY => OBJLIB))` +
    ` Union ` +
    `Select OBJLIB, IASP_NUMBER, DATA_AREA_VALUE, 'Jetty' as TYPE ` +
    `From Table(QSYS2.OBJECT_STATISTICS('*ALL','*DTAARA','JETTYHOME')) ` +
    `Cross Join Table(QSYS2.DATA_AREA_INFO( DATA_AREA_NAME => OBJNAME, DATA_AREA_LIBRARY => OBJLIB))` +
    `Order by TYPE, OBJLIB`
  );
  return (rows.map(row => ({
    library: String(row.OBJLIB).trim(),
    iasp: Number(row.IASP_NUMBER || 0),
    dataArea: String(row.DATA_AREA_VALUE).trim(),
    type: String(row.TYPE).trim(),
  })) as ServerLocation[]);
}