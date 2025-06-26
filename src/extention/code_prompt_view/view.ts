// 界面优化：
// 1. 代码的长度可能过长，把代码块改成超过一定长度之后滚动条展示
// 2. 添加代码块的复制功能
// 3. 

import * as vscode from 'vscode';
import { ModelCodeDate, MEDIA_PATH } from './utils';

export class ModeCodeView {
    private context: vscode.ExtensionContext;
    private data: ModelCodeDate[] = []; // 存储后端数据

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    // 显示Webview面板
    public showPanel(data: ModelCodeDate[]) {
        this.data = data;
        const panel = vscode.window.createWebviewPanel(
            'mode code view',    // 标识符
            '代码补全',          // 标题
            vscode.ViewColumn.Beside, // 显示在编辑器的右侧
            {                   
                enableScripts: true,     // 允许执行脚本
                retainContextWhenHidden: true // 在隐藏时保留Webview上下文
            }
        );

        panel.webview.onDidReceiveMessage(
            message => {
                switch(message.command) {
                    case 'modeCodeReplace':
                        this.replaceEditorContent(message.data);
                        return;
                }
            }
        );

        panel.webview.html = this.getWebviewContent(panel.webview, this.data);
    }

    private getWebviewContent(
        webView: vscode.Webview,
        data: ModelCodeDate[],
    ): string {
        const scriptUri = webView.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, MEDIA_PATH, 'view.js'
        ));

        const styleUri = webView.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, MEDIA_PATH, 'view.css'
        ));

        // 生成代码块HTML
        const codeBlocks = data.map((item, index) => `
            <div class="code-block">
                <h3>${item.modelName}</h3>
                <pre>${item.code}</pre>
                <button class="replace-btn" data-index="${index}">替换代码</button>
                <div class="file-info">[${item.range.start.line}-${item.range.end.line}]</div>
            </div>
        `).join('');

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>代码补全</title>
            <link href="${styleUri}" rel="stylesheet">
        </head>
        <body>
            <h2>代码补全展示</h2>
            <div id="code-container">
                ${codeBlocks}
            </div>
            <script src="${scriptUri}"></script>
        </body>
        </html>`;
    }

    // 替换编辑器内容
    private async replaceEditorContent(index: number) {
        const data = this.data[index];

        const edit = vscode.window.activeTextEditor;
        edit?.edit(
            (editBuilder) => {
                editBuilder.replace(data.range, data.code);
            }
        )
    }
}