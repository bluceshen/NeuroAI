(function() {
    // 初始化VS Code API
    const vscode = acquireVsCodeApi();
    
    // 绑定按钮点击事件
    document.addEventListener('DOMContentLoaded', function() {
        const buttons = document.querySelectorAll('.replace-btn');
        
        buttons.forEach(button => {
            button.addEventListener('click', function() {
                const index = this.getAttribute('data-index');
                vscode.postMessage({
                    command: 'modeCodeReplace',
                    data: index
                });
            });
        });
    });
})();