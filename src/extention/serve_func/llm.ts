import { Logger } from "../../common/logger"
import { StreamRequest as LlmRequest } from "../../common/types"

import {
  logStreamOptions,
  notifyKnownErrors,
  safeParseJsonResponse
} from "../public/utils"

const log = Logger.getInstance()

// 主函数，处理 LLM 请求
export async function llm(request: LlmRequest) {
  logStreamOptions(request) // 记录流选项
  const { body, options, onData, onEnd, onError, onStart } = request
  const controller = new AbortController() // 创建 AbortController 实例
  const { signal } = controller // 获取信号

  // 设置请求超时
  const timeOut = setTimeout(() => {
    controller.abort(new DOMException("Request timed out", "TimeoutError"))
  }, 60000) // 60秒超时

  try {
    // 构建请求的 URL
    const url = `${options.protocol}://${options.hostname}${
      options.port ? `:${options.port}` : ""
    }${options.path}`
    const fetchOptions = {
      method: options.method, // 请求方法
      headers: options.headers, // 请求头
      body: JSON.stringify(body), // 请求体
      signal: controller.signal // 传递信号
    }

    const response = await fetch(url, fetchOptions) // 发送请求
    clearTimeout(timeOut) // 清除超时

    if (!response.ok) {
      throw new Error(`Server responded with status code: ${response.status}`)
    }

    if (!response.body) {
      throw new Error("Failed to get a ReadableStream from the response")
    }

    let buffer = "" // 初始化缓冲区

    onStart?.(controller) // 调用开始回调

    // 如果请求不需要流式响应
    if (body.stream === false) {
      const text = await response.text() // 获取响应文本
      const json = safeParseJsonResponse(text) // 安全解析 JSON 响应

      if (!json || !onData) return // 如果解析失败或没有 onData 回调，返回

      onEnd?.(json) // 调用结束回调
      return
    }

    // 处理流式响应
    const reader = response.body
      .pipeThrough(new TextDecoderStream()) // 解码流
      .pipeThrough(
        new TransformStream({
          start() {
            buffer = "" // 初始化缓冲区
          },
          transform(chunk) {
            buffer += chunk // 将数据添加到缓冲区
            let position
            // 处理缓冲区中的每一行
            while ((position = buffer.indexOf("\n")) !== -1) {
              const line = buffer.substring(0, position) // 获取一行数据
              buffer = buffer.substring(position + 1) // 更新缓冲区
              try {
                const json = safeParseJsonResponse(line) // 安全解析 JSON
                if (json) onData(json) // 调用 onData 回调
              } catch {
                onError?.(new Error("Error parsing JSON data from event")) // 处理解析错误
              }
            }
          },
          flush() {
            // 处理剩余的缓冲区数据
            if (buffer) {
              try {
                const json = safeParseJsonResponse(buffer)
                if (!json) return
                onData(json) // 调用 onData 回调
              } catch {
                onError?.(new Error("Error parsing JSON data from event")) // 处理解析错误
              }
            }
          }
        })
      )
      .getReader() // 获取读取器

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal.aborted) break // 如果请求被中止，退出循环
      const { done } = await reader.read() // 读取数据
      if (done) break // 如果读取完成，退出循环
    }

    controller.abort() // 中止请求
    onEnd?.() // 调用结束回调
    reader.releaseLock() // 释放读取器锁
  } catch (error: unknown) {
    clearTimeout(timeOut) // 清除超时
    controller.abort() // 中止请求
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        onEnd?.() // 如果是中止错误，调用结束回调
      } else if (error.name === "TimeoutError") {
        onError?.(error) // 处理超时错误
        log.logError(
          "timeout",
          "Failed to establish connection",
          error
        )
      } else {
        log.logError("error", "Fetch error", error) // 处理其他错误
        onError?.(error)
        notifyKnownErrors(error) // 通知已知错误
      }
    }
  }
}

// 获取嵌入数据的函数
export async function fetchEmbedding(request: LlmRequest) {
  const { body, options, onData } = request
  const controller = new AbortController() // 创建 AbortController 实例

  try {
    // 构建请求的 URL
    const url = `${options.protocol}://${options.hostname}${
      options.port ? `:${options.port}` : ""
    }${options.path}`
    const fetchOptions = {
      method: options.method, // 请求方法
      headers: options.headers, // 请求头
      body: JSON.stringify(body), // 请求体
      signal: controller.signal // 传递信号
    }

    const response = await fetch(url, fetchOptions) // 发送请求

    if (!response.ok) {
      throw new Error(`Server responded with status code: ${response.status}`)
    }

    if (!response.body) {
      throw new Error("Failed to get a ReadableStream from the response")
    }

    const data = await response.json() // 解析 JSON 响应

    onData(data) // 调用 onData 回调
  } catch (error: unknown) {
    if (error instanceof Error) {
      log.logError("fetch_error", "Fetch error", error) // 记录错误
      notifyKnownErrors(error) // 通知已知错误
    }
  }
}
