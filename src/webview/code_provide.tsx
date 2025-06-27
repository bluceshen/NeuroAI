import * as vscode from 'vscode';

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'yourExtension.sidebar';

    private _view?: vscode.WebviewView;

    constructor(private readonly context: vscode.ExtensionContext) {}

    public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
        };

        webviewView.webview.html = this.getHtmlContent();

        webviewView.webview.onDidReceiveMessage(
            message => {
                // 处理来自 Webview 的消息
            },
            undefined,
            this.context.subscriptions
        );
    }

    private getHtmlContent() {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Sidebar</title>
        </head>
        <body>
            <h1>Your Sidebar Content</h1>
            <div id="content">This is where your content goes.</div>
        </body>
        </html>`;
    }
}
