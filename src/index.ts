import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import {
  commands,
  ExtensionContext,
  languages,
  StatusBarAlignment,
  window,
  workspace
} from "vscode"
import * as vscode from "vscode"

import {
  EVENT_NAME,
  EXTENSION_CONTEXT_NAME,
  EXTENSION_NAME,
  TWINNY_COMMAND_NAME,
  WEBUI_TABS
} from "./common/constants"
import { ServerMessage } from "./common/types"
import { setContext } from "./extention/public/context"
import { EmbeddingDatabase } from "./extention/embeding_func/embeddings"
import { FileInteractionCache } from "./extention/file_func/file-interaction"
import { CompletionProvider } from "./extention/complete_func/completion"
import { FullScreenProvider } from "./extention/provider/panel"
import { SidebarProvider } from "./extention/provider/sidebar"
import { SessionManager } from "./extention/chat_func/session-manager"
import { TemplateProvider } from "./extention/public/template-provider"
import { delayExecution } from "./extention/public/utils"
import { getLineBreakCount } from "./extention/public/utils"

import { ReviseView } from "./extention/revise/view"
import { ModeCodeView } from "./extention/code_prompt_view/view"
import { ModelCodeDate } from "./extention/code_prompt_view/utils"

export async function activate(context: ExtensionContext) {
  setContext(context)
  const config = workspace.getConfiguration("twinny")
  const statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right)
  const templateDir = path.join(os.homedir(), ".twinny/templates") as string
  const templateProvider = new TemplateProvider(templateDir)
  const fileInteractionCache = new FileInteractionCache()
  const sessionManager = new SessionManager()
  const fullScreenProvider = new FullScreenProvider(
    context,
    templateDir,
    statusBarItem

  )


  const homeDir = os.homedir()
  const dbDir = path.join(homeDir, ".twinny/embeddings")
  let db

  if (workspace.name) {
    const dbPath = path.join(dbDir, workspace.name as string)

    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })
    db = new EmbeddingDatabase(dbPath, context)
    await db.connect()
  }

  const sidebarProvider = new SidebarProvider(
    statusBarItem,
    context,
    templateDir,
    db,
    sessionManager
  )

  // 代码补全展示面板
  const modeCodeView = new ModeCodeView(context)
  context.subscriptions.push(commands.registerCommand(
    'modelCode.showView',
    () => {
      modeCodeView.showPanel()
    }
  ))

  const completionProvider = new CompletionProvider(
    statusBarItem,
    fileInteractionCache,
    templateProvider,
    context,
    modeCodeView
  )

  templateProvider.init()

  // 右键代码重审
  const reviseView = new ReviseView(context)
  context.subscriptions.push(commands.registerCommand(
    'ai.revise',
    () => {
      // 选中的代码
      const selectedCode = vscode.window.activeTextEditor?.document.getText(
        vscode.window.activeTextEditor.selection
      )

      const edit = vscode.window.activeTextEditor;
      if (edit === undefined) {
        vscode.window.showErrorMessage("Please select some code to review.")
        return
      }

      // 代码的范围
      const range = vscode.window.activeTextEditor?.selection;

      if (range === undefined) {
        vscode.window.showErrorMessage("Please select some code to review.")
        return
      }

      if (selectedCode) {
        reviseView.showPanel(selectedCode, range, edit)
      }
    }
  ))



  context.subscriptions.push(
    languages.registerInlineCompletionItemProvider(
      { pattern: "**" },
      completionProvider
    ),
    commands.registerCommand(TWINNY_COMMAND_NAME.enable, () => {
      statusBarItem.show()
    }),
    commands.registerCommand(TWINNY_COMMAND_NAME.disable, () => {
      statusBarItem.hide()
    }),
    commands.registerCommand(TWINNY_COMMAND_NAME.explain, () => {
      commands.executeCommand(TWINNY_COMMAND_NAME.focusSidebar)
      delayExecution(() => sidebarProvider?.streamTemplateCompletion("explain"))
    }),
    commands.registerCommand(TWINNY_COMMAND_NAME.addTypes, () => {
      commands.executeCommand(TWINNY_COMMAND_NAME.focusSidebar)
      delayExecution(() =>
        sidebarProvider?.streamTemplateCompletion("add-types")
      )
    }),
    commands.registerCommand(TWINNY_COMMAND_NAME.refactor, () => {
      commands.executeCommand(TWINNY_COMMAND_NAME.focusSidebar)
      delayExecution(() =>
        sidebarProvider?.streamTemplateCompletion("refactor")
      )
    }),
    commands.registerCommand(TWINNY_COMMAND_NAME.generateDocs, () => {
      commands.executeCommand(TWINNY_COMMAND_NAME.focusSidebar)
      delayExecution(() =>
        sidebarProvider?.streamTemplateCompletion("generate-docs")
      )
    }),
    commands.registerCommand(TWINNY_COMMAND_NAME.addTests, () => {
      commands.executeCommand(TWINNY_COMMAND_NAME.focusSidebar)
      delayExecution(() =>
        sidebarProvider?.streamTemplateCompletion("add-tests")
      )
    }),
    commands.registerCommand(
      TWINNY_COMMAND_NAME.templateCompletion,
      (template: string) => {
        commands.executeCommand(TWINNY_COMMAND_NAME.focusSidebar)
        delayExecution(() =>
          sidebarProvider?.streamTemplateCompletion(template)
        )
      }
    ),
    commands.registerCommand(TWINNY_COMMAND_NAME.stopGeneration, () => {
      completionProvider.onError(null)
      sidebarProvider.destroyStream()
    }),
    commands.registerCommand(TWINNY_COMMAND_NAME.manageProviders, async () => {
      commands.executeCommand(
        "setContext",
        EXTENSION_CONTEXT_NAME.twinnyManageProviders,
        true
      )
      sidebarProvider.webView?.postMessage({
        type: EVENT_NAME.twinnySetTab,
        data: WEBUI_TABS.providers
      } as ServerMessage<string>)
    }),
    commands.registerCommand(TWINNY_COMMAND_NAME.embeddings, async () => {
      commands.executeCommand(
        "setContext",
        EXTENSION_CONTEXT_NAME.twinnyEmbeddingsTab,
        true
      )
      sidebarProvider.webView?.postMessage({
        type: EVENT_NAME.twinnySetTab,
        data: WEBUI_TABS.embeddings
      } as ServerMessage<string>)
    }),
    commands.registerCommand(
      TWINNY_COMMAND_NAME.twinnySymmetryTab,
      async () => {
        commands.executeCommand(
          "setContext",
          EXTENSION_CONTEXT_NAME.twinnySymmetryTab,
          true
        )
        sidebarProvider.webView?.postMessage({
          type: EVENT_NAME.twinnySetTab,
          data: WEBUI_TABS.symmetry
        } as ServerMessage<string>)
      }
    ),
    commands.registerCommand(
      TWINNY_COMMAND_NAME.conversationHistory,
      async () => {
        commands.executeCommand(
          "setContext",
          EXTENSION_CONTEXT_NAME.twinnyConversationHistory,
          true
        )
        sidebarProvider.webView?.postMessage({
          type: EVENT_NAME.twinnySetTab,
          data: WEBUI_TABS.history
        } as ServerMessage<string>)
      }
    ),
    commands.registerCommand(TWINNY_COMMAND_NAME.review, async () => {
      commands.executeCommand(
        "setContext",
        EXTENSION_CONTEXT_NAME.twinnyReviewTab,
        true
      )
      sidebarProvider.webView?.postMessage({
        type: EVENT_NAME.twinnySetTab,
        data: WEBUI_TABS.review
      } as ServerMessage<string>)
    }),
    commands.registerCommand(TWINNY_COMMAND_NAME.manageTemplates, async () => {
      commands.executeCommand(
        "setContext",
        EXTENSION_CONTEXT_NAME.twinnyManageTemplates,
        true
      )
      sidebarProvider.webView?.postMessage({
        type: EVENT_NAME.twinnySetTab,
        data: WEBUI_TABS.settings
      } as ServerMessage<string>)
    }),
    commands.registerCommand(TWINNY_COMMAND_NAME.hideBackButton, () => {
      commands.executeCommand(
        "setContext",
        EXTENSION_CONTEXT_NAME.twinnyManageTemplates,
        false
      )
      commands.executeCommand(
        "setContext",
        EXTENSION_CONTEXT_NAME.twinnyConversationHistory,
        false
      )
      commands.executeCommand(
        "setContext",
        EXTENSION_CONTEXT_NAME.twinnySymmetryTab,
        false
      )
      commands.executeCommand(
        "setContext",
        EXTENSION_CONTEXT_NAME.twinnyManageProviders,
        false
      )
      commands.executeCommand(
        "setContext",
        EXTENSION_CONTEXT_NAME.twinnyReviewTab,
        false
      )
    }),
    commands.registerCommand(TWINNY_COMMAND_NAME.openChat, () => {
      commands.executeCommand(TWINNY_COMMAND_NAME.hideBackButton)
      sidebarProvider.webView?.postMessage({
        type: EVENT_NAME.twinnySetTab,
        data: WEBUI_TABS.chat
      } as ServerMessage<string>)
    }),
    commands.registerCommand(TWINNY_COMMAND_NAME.settings, () => {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        EXTENSION_NAME
      )
    }),
    commands.registerCommand(TWINNY_COMMAND_NAME.getGitCommitMessage, () => {
      commands.executeCommand(TWINNY_COMMAND_NAME.focusSidebar)
      sidebarProvider.conversationHistory?.resetConversation()
      delayExecution(() => sidebarProvider.getGitCommitMessage(), 400)
    }),
    commands.registerCommand(TWINNY_COMMAND_NAME.newConversation, () => {
      sidebarProvider.conversationHistory?.resetConversation()
      if (sidebarProvider.chat && sidebarProvider.chat.length > 0)
        sidebarProvider.chat[0].resetConversation()
      sidebarProvider.newSymmetryConversation()
      sidebarProvider.webView?.postMessage({
        type: EVENT_NAME.twinnyNewConversation
      } as ServerMessage<string>)
    }),
    commands.registerCommand(TWINNY_COMMAND_NAME.openPanelChat, () => {
      commands.executeCommand("workbench.action.closeSidebar")
      fullScreenProvider.createOrShowPanel()
    }),
    commands.registerCommand(TWINNY_COMMAND_NAME.addFileToContext, () => {
      const editor = window.activeTextEditor
      if (editor) {
        const currentFile = {
          name: path.basename(editor.document.uri.fsPath),
          path: workspace.asRelativePath(editor.document.uri.fsPath),
          category: "files" as const
        }
        sidebarProvider.addFileToContext(currentFile)
      }
    }),
    workspace.onDidCloseTextDocument((document) => {
      const filePath = document.uri.fsPath
      fileInteractionCache.endSession()
      fileInteractionCache.delete(filePath)
    }),
    workspace.onDidOpenTextDocument((document) => {
      const filePath = document.uri.fsPath
      fileInteractionCache.startSession(filePath)
      fileInteractionCache.incrementVisits()
    }),
    workspace.onDidChangeTextDocument((e) => {
      const changes = e.contentChanges[0]
      if (!changes) return
      const lastCompletion = completionProvider.lastCompletionText
      const isLastCompltionMultiline = getLineBreakCount(lastCompletion) > 1
      completionProvider.setAcceptedLastCompletion(
        !!(
          changes.text &&
          lastCompletion &&
          changes.text === lastCompletion &&
          isLastCompltionMultiline
        )
      )
      const currentLine = changes.range.start.line
      const currentCharacter = changes.range.start.character
      fileInteractionCache.incrementStrokes(currentLine, currentCharacter)
    }),
    window.registerWebviewViewProvider("twinny.sidebar", sidebarProvider),
    statusBarItem
  )

  window.onDidChangeTextEditorSelection(() => {
    completionProvider.abortCompletion()
    delayExecution(() => {
      completionProvider.setAcceptedLastCompletion(false)
    }, 200)
  })

  if (config.get("enabled")) statusBarItem.show()

  statusBarItem.text = "$(code)"
}
