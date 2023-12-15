import vscode from "vscode";

class AFSServerBrowser implements vscode.TreeDataProvider<AFSBrowserItem> {
  private readonly emitter = new vscode.EventEmitter<AFSBrowserItem | undefined | null | void>;
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(target?: AFSBrowserItem) {
    this.emitter.fire(target);
  }

  getTreeItem(element: AFSBrowserItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
    return element;
  }

  getChildren(element?: AFSBrowserItem | undefined): vscode.ProviderResult<AFSBrowserItem[]> {
    return [];
  }

  getParent(element: AFSBrowserItem): vscode.ProviderResult<AFSBrowserItem> {
    return element.parent;
  }
}

type BrowserItemParameters = {
  icon?: string
  state?: vscode.TreeItemCollapsibleState
  parent?: AFSBrowserItem
};

class AFSBrowserItem extends vscode.TreeItem {
  constructor(label: string, readonly params?: BrowserItemParameters) {
    super(label, params?.state);
    this.iconPath = params?.icon ? new vscode.ThemeIcon(params.icon) : undefined;
  }

  get parent() {
    return this.params?.parent;
  }

  getChildren?(): vscode.ProviderResult<AFSBrowserItem[]>;

  refresh() {
    vscode.commands.executeCommand("arcad-afs-for-ibm-i.refresh", this);
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
    vscode.commands.registerCommand("arcad-afs-for-ibm-i.refresh", (item?: AFSBrowserItem) => afsBrowser.refresh(item))
  );
}