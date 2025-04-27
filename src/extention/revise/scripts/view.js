(function() {
    const vscode = acquireVsCodeApi();

    let originalCode = ''; // 原始代码
    let generatedCode = ''; // 生成的代码

    // 初始化时保存原始代码
    document.addEventListener('DOMContentLoaded', () => {
        originalCode = document.querySelector('.code-preview pre').textContent;
    });

    // 处理提交按钮点击
    document.getElementById('submit-btn').addEventListener('click', () => {
        const getCodeContent = () => {
            const codePreviewDiv = document.querySelector('.code-preview');
            if (!codePreviewDiv) {
                console.error('未找到代码预览区域');
                return '';
            }
            
            const preElement = codePreviewDiv.querySelector('pre');
            return preElement?.textContent || '';
        };

        vscode.postMessage({
            command: 'twinnyCodeRevisionRequest',
            panelID: PANEL_ID,
            data: {
                selectedCode: getCodeContent(),
                requirements: document.getElementById('requirements').value || '',
                codeStyle: document.getElementById('code-style').value || 'default',
                addComments: document.getElementById('add-comments').checked || false
            }
        });
    });

    // 处理生成结果
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command) {
            case 'updateGeneratedCode':
                showLoading(false);
                generatedCode = message.content;
                document.getElementById('generated-code-content').textContent = generatedCode;
                document.querySelector('.generated-code').style.display = 'block';
                break;
            case 'error':
                showLoading(false);
                showError(message.message);
                break;
        }
    });

    // 重新生成
    document.getElementById('regenerate-btn').addEventListener('click', () => {
        document.getElementById('submit-btn').click();
    });

    // 替换代码
    document.getElementById('replace-btn').addEventListener('click', () => {
        vscode.postMessage({
            command: 'replaceOriginalCode',
            data: {
                original: originalCode,
                replacement: generatedCode
            }
        });
    });

    // 处理取消按钮
    document.getElementById('cancel-btn').addEventListener('click', () => {
        vscode.postMessage({ 
            command: 'reviseViewClose',
            panelID: PANEL_ID
        });
    });

    function showLoading(show) {
        const submitBtn = document.getElementById('submit-btn');
        submitBtn.disabled = show;
        submitBtn.innerHTML = show ? 
            '<span class="loader"></span> 生成中...' : 
            '生成';
    }

    function showError(message) {
        const indicator = document.querySelector('.status-indicator');
        indicator.textContent = `❌ ${message}`;
        indicator.style.color = 'var(--vscode-errorForeground)';
    }
})();