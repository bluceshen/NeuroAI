/* eslint-disable @typescript-eslint/no-explicit-any */
import * as vscode from "vscode"
import { WebSocket } from "ws"

import { EVENT_NAME, URL_SYMMETRY_WS } from "../../../common/constants"
import { ServerMessage } from "../../../common/types"

// 定义一个名为 SymmetryWs 的类
export class SymmetryWs {
  private _ws: WebSocket | null = null // WebSocket 实例
  private _webView: vscode.Webview | undefined // VSCode Webview 实例
  private _modelData: any = [] // 存储模型数据的数组

  // 构造函数，接收一个 Webview 实例
  constructor(view: vscode.Webview | undefined) {
    this._webView = view // 将传入的 Webview 实例赋值给类属性
    this.registerHandlers() // 注册消息处理程序
  }

  // 连接到对称 WebSocket
  public connectSymmetryWs = () => {
    this._ws = new WebSocket(URL_SYMMETRY_WS) // 创建 WebSocket 实例并连接到指定的 URL

    // 监听 WebSocket 消息事件
    this._ws.on("message", (data: any) => {
      try {
        const parsedData = JSON.parse(data.toString()) // 解析接收到的数据
        // 过滤出在线且健康的对等体
        this._modelData = parsedData?.allPeers?.filter(
          (peer: any) => peer.online && peer.healthy
        )
        // 将模型数据发送到 Webview
        this._webView?.postMessage({
          type: EVENT_NAME.twinnySymmetryModels,
          data: this._modelData
        })
      } catch (error) {
        console.error("解析 WebSocket 消息时出错:", error) // 捕获并打印解析错误
      }
    })

    // 监听 WebSocket 错误事件
    this._ws.on("error", (error: any) => {
      console.error("WebSocket 错误:", error) // 打印错误信息
    })
  }

  // 注册消息处理程序
  public registerHandlers() {
    this._webView?.onDidReceiveMessage(
      async (message: ServerMessage<string>) => {
        // 检查接收到的消息类型
        if (message.type === EVENT_NAME.twinnyGetSymmetryModels) {
          // 将当前模型数据发送到 Webview
          this._webView?.postMessage({
            type: EVENT_NAME.twinnySymmetryModels,
            data: this._modelData
          })
        }
      }
    )
  }

  // 清理资源
  public dispose() {
    if (this._ws) {
      this._ws.close() // 关闭 WebSocket 连接
    }
  }
}
