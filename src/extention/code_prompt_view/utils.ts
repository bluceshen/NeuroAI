import * as vscode from 'vscode';

// 后端传入数据
export type ModelCodeDate = {
    modelName: string
    range: vscode.Range
    code: string
}

export const MEDIA_PATH = 'src/extention/code_prompt_view/media';