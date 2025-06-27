// 界面优化：
// 1. 代码的长度可能过长，把代码块改成超过一定长度之后滚动条展示
// 2. 添加代码块的复制功能
// 3. 
import { SEND_COMPLETION_LIST } from '../../common/constants';
import * as vscode from 'vscode';
import { CompletionDetails } from '../complete_func/completion';
export const MEDIA_PATH = 'src/extention/code_prompt_view/media';

let panel: vscode.WebviewPanel | undefined;

function getPanel(): vscode.WebviewPanel {
    if (panel) {
        return panel;
    }

    panel = vscode.window.createWebviewPanel(
        'mode code view',
        '代码补全',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    return panel;
}


export class ModeCodeView {
    private context: vscode.ExtensionContext;
    private data: CompletionDetails[] = []; // 存储后端数据
    private panel: vscode.WebviewPanel

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.panel = vscode.window.createWebviewPanel(
            'mode code view',
            '代码补全',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );
        this.panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'modeCodeReplace':
                        console.log("Tatch ", message.command)
                        this.replaceEditorContent(message.data as number);
                        return;
                }
            }
        );
    }

    public setData() {
        this.data = []
        // 获取存储的列表数据
        const list = this.context.globalState.get<CompletionDetails[]>(SEND_COMPLETION_LIST);

        // 创建转换函数，用于将每个元素转换为新对象
        function convertToViewData(item: any): CompletionDetails & { position: vscode.Range } {
            const start = new vscode.Position(item.position_start_line ?? 0, item.position_start_character ?? 0);
            const end = new vscode.Position(item.position_end_line ?? 0, item.position_end_character ?? 0);

            return {
                model: item.model ?? 'default',
                code: item.code ?? '',
                position_start_line: item.position_start_line ?? 0,
                position_start_character: item.position_start_character ?? 0,
                position_end_line: item.position_end_line ?? 0,
                position_end_character: item.position_end_character ?? 0,
                position: new vscode.Range(start, end)
            };
        }


        if (Array.isArray(list)) {
            // 使用map方法逐个转换list中的元素
            this.data = list.map((item) => {
                return convertToViewData(item);
            });
        } else {
            // list不是数组，初始化this.data为默认值
            // this.data = [{ model: "pdd", position: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)), code: "ghjgh" }];
        }

        if (this.panel.visible) {
            this.panel.webview.html = this.getWebviewContent(this.panel.webview, this.data);
        }
    }

    // 显示Webview面板
    public showPanel() {
        this.data = []
        // const panel = getPanel();
        this.panel = vscode.window.createWebviewPanel(
            'mode code view',
            '代码补全',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );
        this.panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'modeCodeReplace':
                        console.log("Tatch ", message.command)
                        this.replaceEditorContent(message.data as number);
                        return;
                }
            }
        );
        this.setData();
        // this.panel.webview.html = this.getWebviewContent(this.panel.webview, this.data);
    }

    private getWebviewContent(
        webView: vscode.Webview,
        data: CompletionDetails[],
    ): string {
        console.log("Web:", data);
        const scriptUri = webView.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, MEDIA_PATH, 'view.js'
        ));

        const styleUri = webView.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, MEDIA_PATH, 'view.css'
        ));

        // 生成代码块HTML
        const codeBlocks = data.map((item, index) => {
            console.log("Data is the ", item)
            return `<div class="code-block">
                <h3>${item.model}</h3>
                <pre>${item.code}</pre>
                <button class="replace-btn" data-index="${index}">替换代码</button>
                <div class="file-info">[${item.position_start_line}-${item.position_end_line}]</div>
            </div>
            `
        }).join('');

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
        console.log("Index is ", index)

        const edit = vscode.window.activeTextEditor;
        edit?.edit(
            (editBuilder) => {
                editBuilder.replace(new vscode.Range(
                    new vscode.Position(data.position_start_line, data.position_start_character),
                    new vscode.Position(data.position_end_line, data.position_end_character)),
                    data.code);
            }
        )
    }
}