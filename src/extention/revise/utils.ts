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
    baseURL: 'https://vip.apiyi.com/v1',
    apiKey: 'sk-PzDXw2zVorMNVCcS4eAfD6FbAeFc48De82B6831cAd16156c',
    // baseURL: 'https://dashscope.aliyuncs.com/api/v1/',
    // apiKey: 'sk-PzDXw2zVorMNVCcS4eAfD6FbAeFc48De82B6831cAd16156c',
})

const parse = (data: RequestData) => {
    return `
        你是一个代码重写助手，请严格遵循以下要求：
        1. 仅返回重写后的代码
        2. 不要包含任何解释性文本、Markdown标记或额外说明
        3. ${data.addComments ? "保留必要注释" : "移除所有注释"}
        4. 严格遵守代码风格: ${data.codeStyle}

        原始代码:
        ${data.selectedCode}

        修改要求:
        ${data.requirements}.
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
            model: "gpt-3.5-turbo-0125",
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