/**
 * 
 * 工具函数
 */

export const STYLE_URL = 'src/extention/revise/scripts';

export type RequestData = {
    selectedCode: string,
    requirements: string,
    codeStyle: string,
    addComments: boolean
}

export const SIGN_NAME = {
    reviseCodeEable: 'reviseCodeEable',
    reviseViewClose: 'reviseViewClose',
    replaceOriginalCode: 'replaceOriginalCode',
    updateGeneratedCode: 'updateGeneratedCode'
}

// 转义html
export function escapeHtml(unsafe: string): string {
    return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function generateCodeRevision(data: any): string {
    return `// 生成的示例代码\nfunction revised() {\n  // ${data.selectedCode}\n}`;
    // TODO: 获取代码Revision
}