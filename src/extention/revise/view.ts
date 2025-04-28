/**
 * 提供基础的 view 面板
 */

import * as vscode from "vscode";
import * as viewUtils from "./utils";


export class ReviseView {

    context: vscode.ExtensionContext;
    panel = new Map<string, vscode.WebviewPanel>();

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    // 显示面板
    public showPanel(
        selectedCode: string | undefined | null,
        range: vscode.Selection,
        edit: vscode.TextEditor
    ) {
        if(selectedCode == null || selectedCode == undefined) {
            vscode.window.showErrorMessage("Please select code to revise.");
            return;
        }

        const panelID = Date.now().toString();

        // 创建Webview面板
        const panel = vscode.window.createWebviewPanel(
            'aiRevisePanel',    // 标识符
            '代码修订',          // 标题
            vscode.ViewColumn.Beside, // 显示在编辑器的右侧
            {                   
                enableScripts: true,     // 允许执行脚本
                retainContextWhenHidden: true // 在隐藏时保留Webview上下文
            }
        );

        this.panel.set(panelID, panel);

        panel.webview.onDidReceiveMessage(async message => {
            switch(message.command) {
                case viewUtils.SIGN_NAME.reviseViewClose:
                    this.closePanel(panelID);
                    break;
                case viewUtils.SIGN_NAME.reviseCodeEable:
                    this.handleRevisionRequest(panelID, message.data);
                    break;
                case viewUtils.SIGN_NAME.replaceOriginalCode:
                    this.updateGeneratedCode(range, message.data, edit);
                    break;
            }
        }, undefined, this.context.subscriptions)

        panel.webview.html = this.getWebviewContent(panel.webview, selectedCode, panelID);

        // TODO: 执行可选的生成操作
        // TODO: 从远程大模型api调用生成结果
        // TODO: 发送到本地Chat模块
        // TODO: 代码差异化对比
    }

    // 获取webview的html
    private getWebviewContent(
        webView: vscode.Webview, 
        code: string,
        panelID: string
    ): string {
        // 获取资源URI
        const styleUri = webView.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, viewUtils.STYLE_URL, "view.css")
        );
    
        const scriptUri = webView.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, viewUtils.STYLE_URL, "view.js")
        );

        // 安全策略
        const csp = `
        <meta http-equiv="Content-Security-Policy" 
            content="default-src 'none';
            img-src ${webView.cspSource} https:;
            script-src ${webView.cspSource} 'unsafe-inline';
            style-src ${webView.cspSource} 'unsafe-inline';
            connect-src ${webView.cspSource};">
        `;

        return `
        <!DOCTYPE html>
        <html>
        <head>
            ${csp}
            <link rel="stylesheet" href="${styleUri}">
                <script>
                    const PANEL_ID = '${panelID}'; // 注入面板ID
                </script>
        </head>
        <body>
            <h2>代码修订选项</h2>
            
            <div class="code-preview">
                <pre>${viewUtils.escapeHtml(code)}</pre>
            </div>

            <div class="form-control">
                <label for="requirements">修改要求：</label>
                <textarea 
                    id="requirements" 
                    rows="3" 
                    placeholder="例如：添加错误处理..."
                    class="form-control"
                ></textarea>
            </div>

            <div class="form-control">
                <label for="code-style">代码风格：</label>
                <select id="code-style" class="form-control">
                    <option value="default">默认</option>
                    <option value="functional">函数式</option>
                    <option value="oop">面向对象</option>
                </select>
            </div>

            <div class="form-control">
                <label>
                    <input type="checkbox" id="add-comments">
                    添加注释
                </label>
            </div>

            <!-- 生成的代码展示 -->
            <div class="code-section generated-code" style="display: none;">
                <h3>生成结果 <span class="status-indicator"></span></h3>
                <div class="code-after">
                    <pre id="generated-code-content">
                    </pre>
                </div>

                <div class="loading-indicator" style="display: none;">
                    <div class="spinner"></div>
                    <span>生成中...</span>
                </div>

                <div class="button-group">
                    <button id="replace-btn" class="form-control">替换原始代码</button>
                </div>
            </div>

            <div class="button-group">
                <button id="submit-btn" class="form-control">生成</button>
                <button id="cancel-btn" class="form-control">取消</button>
            </div>

            <script src="${scriptUri}"></script>
        </body>
        </html>
        `;
    }

    // 关闭面板
    public closePanel(panelID: string) {
        const panel = this.panel.get(panelID);
        if (panel) {
            panel.dispose();
            this.panel.delete(panelID);
        }
    }

    // 处理请求
    private async handleRevisionRequest(panelID: string, data: viewUtils.RequestData) {
        try {
            // 立即通知前端开始加载
            this.panel.get(panelID)?.webview.postMessage({
                command: viewUtils.SIGN_NAME.updateGeneratedCode,
                content: '' // 清空内容
            });

            const newCode = await viewUtils.generateCodeRevision(data);
            this.panel.get(panelID)?.webview.postMessage({
                command: viewUtils.SIGN_NAME.updateGeneratedCode,
                content: newCode
            });
        } catch (error) {
            console.error("处理请求失败:", error);
        }
    }

    private updateGeneratedCode(
        range: vscode.Selection, 
        newCode: string,
        edit: vscode.TextEditor
    ) {
        edit.edit(
            (editBuilder) => {
                // 使用新的替换逻辑
                const currentRange = new vscode.Range(
                    range.start.line,
                    range.start.character,
                    range.end.line,
                    range.end.character
                );
                editBuilder.replace(currentRange, newCode);
            }
        )
    }
}