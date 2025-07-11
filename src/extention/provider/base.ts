import { ChatCompletionMessageParam, models } from "fluency.js"
import { serverMessageKeys } from "symmetry-core"
import * as vscode from "vscode"

import {
  ACTIVE_FIM_PROVIDER_STORAGE_KEY,
  EVENT_NAME,
  EXTENSION_SESSION_NAME,
  SYMMETRY_EMITTER_KEY,
  SYSTEM,
  TWINNY_COMMAND_NAME,
  WORKSPACE_STORAGE_KEY,
  GLOBAL_STORAGE_KEY,
  SEND_COMPLETION_LIST //------
} from "../../common/constants"
import { logger } from "../../common/logger"
import {
  ApiModel,
  ChatCompletionMessage,
  ClientMessage,
  ContextFile,
  FileContextItem,
  InferenceRequest,
  LanguageType,
  ServerMessage,
  ThemeType
} from "../../common/types"
import { Chat } from "../chat_func/chat"
import { ConversationHistory } from "../chat_func/conversation-history"
import { DiffManager } from "../diff_func/diff"
import { EmbeddingDatabase } from "../embeding_func/embeddings"
import { OllamaService } from "../serve_func/ollama"
import { ProviderManager, TwinnyProvider } from "../serve_func/provider-manager"
import { GithubService as ReviewService } from "../public/review-service"
import { SessionManager } from "../chat_func/session-manager"
import { SymmetryService } from "../serve_func/symmetry/symmetry-service"
import { TemplateProvider } from "../public/template-provider"
import { FileTreeProvider } from "../file_func/tree"
import {
  createSymmetryMessage,
  getGitChanges,
  getLanguage,
  getTextSelection,
  getTheme
} from "../public/utils"

export class BaseProvider {
  private _diffManager = new DiffManager()
  private _embeddingDatabase: EmbeddingDatabase | undefined
  private _fileTreeProvider: FileTreeProvider
  private _ollamaService: OllamaService | undefined
  private _sessionManager: SessionManager | undefined
  private _statusBarItem: vscode.StatusBarItem
  private _symmetryService?: SymmetryService
  private _templateDir: string | undefined
  private _templateProvider: TemplateProvider
  public chat: Chat[] | undefined
  public context: vscode.ExtensionContext
  public conversationHistory: ConversationHistory | undefined
  public reviewService: ReviewService | undefined
  public webView?: vscode.Webview

  constructor(
    context: vscode.ExtensionContext,
    templateDir: string,
    statusBar: vscode.StatusBarItem,
    db?: EmbeddingDatabase,
    sessionManager?: SessionManager
  ) {
    this.context = context
    this._fileTreeProvider = new FileTreeProvider()
    this._embeddingDatabase = db
    this._ollamaService = new OllamaService()
    this._sessionManager = sessionManager
    this._statusBarItem = statusBar
    this._templateDir = templateDir
    this._templateProvider = new TemplateProvider(templateDir)
  }

  public registerWebView(webView: vscode.Webview) {
    this.webView = webView
    this.initializeServices()
    this.registerEventListeners()
  }

  // 改变chat数组，能做到当choseModel改变时，自动更新chat
  private changeChatArray() {
    if (!this.webView || !this._symmetryService) return

    // 获取providers数组
    const providers: TwinnyProvider[] | undefined = this.context.globalState.get("twinny.chosenModels")
    // 将chat重置为未定义
    this.chat = undefined
    if (!providers) return
    // 将chat重置为空数组
    this.chat = []
    // 遍历 providers 数组并创建 Chat 实例
    // 将对象的键提取为数组
    const providerKeys = Object.keys(providers);

    // 使用for循环遍历每个provider
    for (const key in providers) {
      if (providers.hasOwnProperty(key)) {
        // 创建一个新的Chat实例并添加到chat列表中
        this.chat.push(new Chat(
          this._statusBarItem,
          this._templateDir,
          this.context,
          this.webView,
          this._embeddingDatabase,
          this._sessionManager,
          this._symmetryService,
          providers[key],
        ));
      }
    }

    // 判断当前的chat是否可用
    if (!this.chat || this.chat.length < 1) return false;
    return true;
  }

  private initializeServices() {
    if (!this.webView) return
    this._symmetryService = new SymmetryService(
      this.webView,
      this._sessionManager,
      this.context
    )

    this.conversationHistory = new ConversationHistory(
      this.context,
      this.webView,
    )

    this.changeChatArray();

    this.reviewService = new ReviewService(
      this.context,
      this.webView,
      this._templateDir
    )

    new ProviderManager(this.context, this.webView)
  }

  private registerEventListeners() {
    vscode.window.onDidChangeActiveColorTheme(this.handleThemeChange)
    vscode.window.onDidChangeTextEditorSelection(this.handleTextSelection)

    const eventHandlers = {
      [EVENT_NAME.twinnyAcceptSolution]: this.acceptSolution,
      [EVENT_NAME.twinnyChatMessage]: this.streamChatCompletion,
      [EVENT_NAME.twinnyClickSuggestion]: this.clickSuggestion,
      [EVENT_NAME.twinnyEmbedDocuments]: this.embedDocuments,
      [EVENT_NAME.twinnyFetchOllamaModels]: this.fetchOllamaModels,
      [EVENT_NAME.twinnyGetConfigValue]: this.getConfigurationValue,
      [EVENT_NAME.twinnyGetGitChanges]: this.getGitCommitMessage,
      [EVENT_NAME.twinnyGetWorkspaceContext]: this.getTwinnyWorkspaceContext,
      [EVENT_NAME.twinnyGlobalContext]: this.getGlobalContext,
      [EVENT_NAME.twinnyHideBackButton]: this.twinnyHideBackButton,
      [EVENT_NAME.twinnyListTemplates]: this.listTemplates,
      [EVENT_NAME.twinnyNewDocument]: this.createNewUntitledDocument,
      [EVENT_NAME.twinnyNotification]: this.sendNotification,
      [EVENT_NAME.twinnyOpenDiff]: this.openDiff,
      [EVENT_NAME.twinnySendLanguage]: this.getCurrentLanguage,
      [EVENT_NAME.twinnySendTheme]: this.getTheme,
      [EVENT_NAME.twinnySessionContext]: this.getSessionContext,
      [EVENT_NAME.twinnySetConfigValue]: this.setConfigurationValue,
      [EVENT_NAME.twinnySetGlobalContext]: this.setGlobalContext,
      [EVENT_NAME.twinnySetTab]: this.setTab,
      [EVENT_NAME.twinnySetWorkspaceContext]: this.setWorkspaceContext,
      [EVENT_NAME.twinnyTextSelection]: this.getSelectedText,
      [EVENT_NAME.twinnyFileListRequest]: this.fileListRequest,
      [EVENT_NAME.twinnyNewConversation]: this.twinnyNewConversation,
      [EVENT_NAME.twinnyEditDefaultTemplates]: this.editDefaultTemplates,
      [EVENT_NAME.twinntGetLocale]: this.sendLocaleToWebView,
      [EVENT_NAME.twinnyGetModels]: this.sendModelsToWebView,
      [EVENT_NAME.twinnyStopGeneration]: this.destroyStream,
      [EVENT_NAME.twinnyGetContextFiles]: this.getContextFiles,
      [EVENT_NAME.twinnyRemoveContextFile]: this.removeContextFile,
      [TWINNY_COMMAND_NAME.settings]: this.openSettings
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.webView?.onDidReceiveMessage((message: any) => {
      const eventHandler = eventHandlers[message.type as string]
      if (eventHandler) eventHandler(message)
    })
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("twinny")) return
      this.sendLocaleToWebView()
    })
  }

  public getFimProvider = () => {
    return this.context.globalState.get<TwinnyProvider>(
      ACTIVE_FIM_PROVIDER_STORAGE_KEY
    )
  }

  private sendModelsToWebView = () => {
    this.webView?.postMessage({
      type: EVENT_NAME.twinnyGetModels,
      data: models
    })
  }

  private sendLocaleToWebView = () => {
    this.webView?.postMessage({
      type: EVENT_NAME.twinnySetLocale,
      data: vscode.workspace.getConfiguration("twinny").get("locale") as string
    })
  }

  private handleThemeChange = () => {
    this.webView?.postMessage({
      type: EVENT_NAME.twinnySendTheme,
      data: getTheme()
    } as ServerMessage<ThemeType>)
  }

  private handleTextSelection = (
    event: vscode.TextEditorSelectionChangeEvent
  ) => {
    const text = event.textEditor.document.getText(event.selections[0])
    this.sendTextSelectionToWebView(text)
  }

  public newSymmetryConversation() {
    this._symmetryService?.write(
      createSymmetryMessage(serverMessageKeys.newConversation)
    )
  }

  public editDefaultTemplates = async () => {
    if (!this._templateDir) return
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.file(this._templateDir),
      true
    )
  }

  public destroyStream = () => {
    // 首先chat不能时未定义状态
    if (this.chat) {
      // 遍历chat，让它每一个都停止
      for (let i = 0; i < this.chat?.length; i++) {
        this.chat[i]?.abort()
      }
    }

    console.log()// todo

    this.reviewService?.abort()
    this.webView?.postMessage({
      type: EVENT_NAME.twinnyStopGeneration
    })
  }

  public async streamTemplateCompletion(template: string) {
    // 首先chat不能时未定义状态
    if (this.chat) {
      // 遍历chat，让它每一个都停止
      for (let i = 0; i < this.chat?.length; i++) {
        const symmetryConnected = this._sessionManager?.get(
          EXTENSION_SESSION_NAME.twinnySymmetryConnection
        )
        if (symmetryConnected && this.chat) {
          const messages = await this.chat[i].getTemplateMessages(template)
          logger.log(`
            Using symmetry for inference
            Messages: ${JSON.stringify(messages)}
          `)
          return this._symmetryService?.write(
            createSymmetryMessage<InferenceRequest>(serverMessageKeys.inference, {
              messages,
              key: SYMMETRY_EMITTER_KEY.inference
            })
          )
        }
        this.chat[i]?.templateCompletion(template)
      }
    }
  }

  addFileToContext = (file: ContextFile) => {
    const files =
      this.context?.workspaceState.get<ContextFile[]>(
        WORKSPACE_STORAGE_KEY.contextFiles
      ) || []
    const isUnique = !files.some(
      (existingFile) => existingFile.path === file.path
    )
    if (isUnique) {
      const updatedFiles = [...files, file]
      this.saveContextFiles(updatedFiles)
      this.notifyWebView(updatedFiles)
    }
  }

  getContextFiles = () => {
    const files =
      this.context?.workspaceState.get<ContextFile[]>(
        WORKSPACE_STORAGE_KEY.contextFiles
      ) || []
    this.notifyWebView(files)
  }

  removeContextFile = (data: { data: string }) => {
    const files =
      this.context?.workspaceState.get<ContextFile[]>(
        WORKSPACE_STORAGE_KEY.contextFiles
      ) || []
    const updatedFiles = files.filter((file) => file.path !== data.data)
    this.saveContextFiles(updatedFiles)
    this.notifyWebView(updatedFiles)
  }

  private saveContextFiles = (files: ContextFile[]) => {
    this.context?.workspaceState.update(WORKSPACE_STORAGE_KEY.contextFiles, files)
  }

  private notifyWebView = (files: ContextFile[]) => {
    this.webView?.postMessage({
      type: EVENT_NAME.twinnyAddOpenFilesToContext,
      data: files
    } as ServerMessage<ContextFile[]>)
  }

  public getGitCommitMessage = async () => {
    const diff = await getGitChanges()
    if (!diff.length) {
      vscode.window.showInformationMessage(
        "No changes found in the current workspace."
      )
      return
    }
    this.conversationHistory?.resetConversation()
  }

  private twinnyNewConversation = () => {
    this.conversationHistory?.resetConversation()
    this.newSymmetryConversation()
    this.webView?.postMessage({
      type: EVENT_NAME.twinnyNewConversation
    } as ServerMessage<string>)
  }

  private openSettings = () => {
    vscode.commands.executeCommand(TWINNY_COMMAND_NAME.settings)
  }

  private setTab = (tab: ClientMessage) => {
    this.webView?.postMessage({
      type: EVENT_NAME.twinnySetTab,
      data: tab
    } as ServerMessage<string>)
  }

  private embedDocuments = async () => {
    const dirs = vscode.workspace.workspaceFolders
    if (!dirs?.length) {
      vscode.window.showErrorMessage("No workspace loaded.")
      return
    }
    if (!this._embeddingDatabase) return
    for (const dir of dirs) {
      (
        await this._embeddingDatabase.injestDocuments(dir.uri.fsPath)
      ).populateDatabase()
    }
  }

  private getConfigurationValue = (message: ClientMessage) => {
    if (!message.key) return
    const config = vscode.workspace.getConfiguration("twinny")
    this.webView?.postMessage({
      type: EVENT_NAME.twinnyGetConfigValue,
      data: config.get(message.key)
    } as ServerMessage<string>)
  }

  private fileListRequest = async (message: ClientMessage) => {
    if (message.type === EVENT_NAME.twinnyFileListRequest) {
      const files = await this._fileTreeProvider?.getAllFiles()
      this.webView?.postMessage({
        type: EVENT_NAME.twinnyFileListResponse,
        data: files
      })
    }
  }

  private setConfigurationValue = (message: ClientMessage) => {
    if (!message.key) return
    const config = vscode.workspace.getConfiguration("twinny")
    config.update(message.key, message.data, vscode.ConfigurationTarget.Global)
  }

  private fetchOllamaModels = async () => {
    try {
      const models = await this._ollamaService?.fetchModels()
      if (!models?.length) {
        return
      }
      this.webView?.postMessage({
        type: EVENT_NAME.twinnyFetchOllamaModels,
        data: models
      } as ServerMessage<ApiModel[]>)
    } catch {
      return
    }
  }

  private listTemplates = () => {
    const templates = this._templateProvider.listTemplates()
    this.webView?.postMessage({
      type: EVENT_NAME.twinnyListTemplates,
      data: templates
    } as ServerMessage<string[]>)
  }

  private sendNotification = (message: ClientMessage) => {
    vscode.window.showInformationMessage(message.data as string)
  }

  private clickSuggestion = (message: ClientMessage) => {
    vscode.commands.executeCommand(
      "twinny.templateCompletion",
      message.data as string
    )
  }

  private streamChatCompletion = async (
    data: ClientMessage<ChatCompletionMessageParam[]>
  ) => {
  const symmetryConnected = this._sessionManager?.get(
    EXTENSION_SESSION_NAME.twinnySymmetryConnection
  );
  
  // 1. 对称连接处理
  if (symmetryConnected) {
    const systemMessage = {
      role: SYSTEM,
      content: await this._templateProvider?.readSystemMessageTemplate()
    };

    const messages = [
      systemMessage,
      ...(data.data as ChatCompletionMessage[])
    ].map(m => ({
      ...m,
      content: m.content
    }));

    logger.log(`Using symmetry for inference\nMessages: ${JSON.stringify(messages)}`);

    return this._symmetryService?.write(
      createSymmetryMessage(serverMessageKeys.inference, {
        messages,
        key: SYMMETRY_EMITTER_KEY.inference
      })
    );
  }

  // 2. 非对称连接处理（改为同步执行）
  if (this.changeChatArray() && this.chat) {
    // 顺序处理每个聊天实例
    for (let i = 0; i < this.chat.length; i++) {
      const instance = this.chat[i];
      if (!instance) continue; // 跳过无效实例
      
      try {
        // 等待当前实例完成后再处理下一个
        await instance.completion(
          data.data || [],
          data.meta as FileContextItem[],
          data.key, // 传递会话ID,
          data.isRAGEnabled,
          data.text
        );
      } catch (error) {
        // 处理错误但不中断后续实例
        logger.error(`Completion failed for instance ${i}`);
      }
    }
  }
};

  private getSelectedText = () => {
    this.sendTextSelectionToWebView(getTextSelection())
  }

  private openDiff = async (message: ClientMessage) => {
    await this._diffManager.openDiff(message)
  }

  private acceptSolution = async (message: ClientMessage) => {
    await this._diffManager.acceptSolution(message)
  }

  private createNewUntitledDocument = async (message: ClientMessage) => {
    const lang = getLanguage()
    const document = await vscode.workspace.openTextDocument({
      content: message.data as string,
      language: lang.languageId
    })
    await vscode.window.showTextDocument(document)
  }

  private getGlobalContext = (message: ClientMessage) => {
    const storedData = this.context?.globalState.get(
      `${EVENT_NAME.twinnyGlobalContext}-${message.key}`
    )
    this.webView?.postMessage({
      type: `${EVENT_NAME.twinnyGlobalContext}-${message.key}`,
      data: storedData
    })
  }

  private getTheme = () => {
    this.webView?.postMessage({
      type: EVENT_NAME.twinnySendTheme,
      data: getTheme()
    } as ServerMessage<ThemeType>)
  }

  private getCurrentLanguage = () => {
    this.webView?.postMessage({
      type: EVENT_NAME.twinnySendLanguage,
      data: getLanguage()
    } as ServerMessage<LanguageType>)
  }

  private getSessionContext = (data: ClientMessage) => {
    if (!data.key) return undefined
    return this.webView?.postMessage({
      type: `${EVENT_NAME.twinnySessionContext}-${data.key}`,
      data: this._sessionManager?.get(data.key)
    })
  }

  private setGlobalContext = (message: ClientMessage) => {
    this.context?.globalState.update(
      `${EVENT_NAME.twinnyGlobalContext}-${message.key}`,
      message.data
    )
  }

  private getTwinnyWorkspaceContext = (message: ClientMessage) => {
    const storedData = this.context?.workspaceState.get(
      `${EVENT_NAME.twinnyGetWorkspaceContext}-${message.key}`
    )
    this.webView?.postMessage({
      type: `${EVENT_NAME.twinnyGetWorkspaceContext}-${message.key}`,
      data: storedData
    } as ServerMessage)
  }

  private setWorkspaceContext = <T>(message: ClientMessage<T>) => {
    const data = message.data
    this.context.workspaceState.update(
      `${EVENT_NAME.twinnyGetWorkspaceContext}-${message.key}`,
      data
    )
    this.webView?.postMessage({
      type: `${EVENT_NAME.twinnyGetWorkspaceContext}-${message.key}`,
      data
    })
  }

  private twinnyHideBackButton() {
    vscode.commands.executeCommand(TWINNY_COMMAND_NAME.hideBackButton)
  }

  private sendTextSelectionToWebView(text: string) {
    this.webView?.postMessage({
      type: EVENT_NAME.twinnyTextSelection,
      data: text
    })
  }
}
