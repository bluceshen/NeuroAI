/**
 * 
 * 工具函数
 */

import OpenAI from "openai";

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

const deepseek = new OpenAI({
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: ' ',
})

const parse = (data: RequestData) => {
    return `
        You are an assistant, 
        please rewrite the given code as per the specified requirements. 
        Directly give a new code for the specified requirements.
        Original code: ${escapeHtml(data.selectedCode)}, 
        requirements: ${escapeHtml(data.requirements)}, 
        code style: ${escapeHtml(data.codeStyle)}, 
        comment or not: ${data.addComments ? "Yes" : "No"}.
    `;
}

// utils.ts 修改部分
export async function generateCodeRevision(data: RequestData): Promise<string> {
    try {
        const completion = await deepseek.chat.completions.create({
            messages: [
                {
                    role: "user",
                    content: parse(data)
                }
            ],
            model: "deepseek-r1",
        });

        if (completion.choices?.[0]?.message?.content) {
            return completion.choices[0].message.content;
        }
        return `
            错误1: 未生成有效内容.
        `;
    } catch (error: any) {
        // 输出具体错误信息
        console.error('API错误详情:', {
            status: error?.status,
            code: error?.code,
            message: error?.message,
            response: error?.response?.data
        });
        return `
            错误2: 请求失败，请检查控制台. 
            错误信息: ${error?.message},
            状态码: ${error?.status}
            响应数据: ${JSON.stringify(error?.response?.data)}
        `;
    }
}