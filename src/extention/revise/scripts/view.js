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
        // 显示加载提示
        const loadingIndicator = document.querySelector('.loading-indicator');
        const generatedCodeSection = document.querySelector('.generated-code');
        loadingIndicator.style.display = 'flex';
        generatedCodeSection.style.display = 'block';
        document.getElementById('generated-code-content').textContent = '';

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
            command: 'reviseCodeEable',
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
                document.querySelector('.loading-indicator').style.display = 'none';
                generatedCode = message.content;
                document.getElementById('generated-code-content').textContent = generatedCode;
                document.querySelector('.generated-code').style.display = 'block';
                break;
            case 'error':
                showError(message.message);
                break;
        }
    });

    // 替换代码
    document.getElementById('replace-btn').addEventListener('click', () => {
        vscode.postMessage({
            command: 'replaceOriginalCode',
            panelID: PANEL_ID,
            data: generatedCode
        });

        setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = '替换原始代码';
        }, 2000);
    });

    // 处理取消按钮
    document.getElementById('cancel-btn').addEventListener('click', () => {
        vscode.postMessage({ 
            command: 'reviseViewClose',
            panelID: PANEL_ID
        });
    });

    function showError(message) {
        const indicator = document.querySelector('.status-indicator');
        indicator.textContent = `❌ ${message}`;
        indicator.style.color = 'var(--vscode-errorForeground)';
    }
})();