import AsyncLock from "async-lock"
import fs from "fs"
import ignore from "ignore"
import path from "path"
import {
  ExtensionContext,
  InlineCompletionContext,
  InlineCompletionItem,
  InlineCompletionItemProvider,
  InlineCompletionList,
  InlineCompletionTriggerKind,
  Position,
  Range,
  StatusBarItem,
  TextDocument,
  Uri,
  window,
  workspace
} from "vscode"
import Parser, { SyntaxNode } from "web-tree-sitter"

import "string_score"

import {
  CLOSING_BRACKETS,
  FIM_TEMPLATE_FORMAT,
  LINE_BREAK_REGEX,
  MAX_CONTEXT_LINE_COUNT,
  MAX_EMPTY_COMPLETION_CHARS,
  MIN_COMPLETION_CHUNKS,
  MULTI_LINE_DELIMITERS,
  MULTILINE_INSIDE,
  MULTILINE_OUTSIDE,
  OPENING_BRACKETS
} from "../../common/constants"
import { supportedLanguages } from "../../common/languages"
import { logger } from "../../common/logger"
import {
  Bracket,
  FimTemplateData,
  PrefixSuffix,
  RepositoryLevelData as RepositoryDocment,
  ResolvedInlineCompletion,
  StreamRequestOptions,
  StreamResponse
} from "../../common/types"
import { Base } from "../public/base"
import { cache } from "../public/cache"
import { CompletionFormatter } from "./completion-formatter"
import { FileInteractionCache } from "../file_func/file-interaction"
import {
  getFimPrompt,
  getFimTemplateRepositoryLevel,
  getStopWords
} from "./fim-templates"
import { llm } from "../serve_func/llm"
import { getNodeAtPosition, getParser } from "./parser"
import { TwinnyProvider, Providers } from "../serve_func/provider-manager"
import { createStreamRequestBodyFim } from "../serve_func/provider-options"
import { TemplateProvider } from "../public/template-provider"
import {
  getCurrentLineText,
  getFimDataFromProvider,
  getIsMiddleOfString,
  getIsMultilineCompletion,
  getPrefixSuffix,
  getShouldSkipCompletion,
  getLineBreakCount
} from "../public/utils"

// 新增接口，管理局部状态
interface LocalState {
  completion: string;
  chunkCount: number;
  abortController: AbortController | null;
  onDataNums: number;
  position: Position | null;
  nonce: number;
}

export class CompletionProvider
  extends Base
  implements InlineCompletionItemProvider {
  private _abortController: AbortController | null
  private _acceptedLastCompletion = false
  private _chunkCount = 0
  private _completion = ""
  private _debouncer: NodeJS.Timeout | undefined
  private _document: TextDocument | null
  private _fileInteractionCache: FileInteractionCache
  private _isMultilineCompletion = false
  private _lastCompletionMultiline = false
  private _lock: AsyncLock
  private _nodeAtPosition: SyntaxNode | null = null
  private _nonce = 0
  private _parser: Parser | undefined
  private _position: Position | null
  private _prefixSuffix: PrefixSuffix = { prefix: "", suffix: "" }
  private _provider: TwinnyProvider[] | undefined
  private _statusBar: StatusBarItem
  private _templateProvider: TemplateProvider
  private _usingFimTemplate = false
  private _finalResults: InlineCompletionItem[] = []
  public lastCompletionText = ""


  constructor(
    statusBar: StatusBarItem,
    fileInteractionCache: FileInteractionCache,
    templateProvider: TemplateProvider,
    context: ExtensionContext
  ) {
    super(context)
    this._abortController = null
    this._document = null
    this._lock = new AsyncLock()
    this._position = null
    this._statusBar = statusBar
    this._fileInteractionCache = fileInteractionCache
    this._templateProvider = templateProvider
  }

  private buildFimRequest(prompt: string, provider: TwinnyProvider) {
    const body = createStreamRequestBodyFim(provider.provider, prompt, {
      model: provider.modelName,
      numPredictFim: this.config.numPredictFim,
      temperature: this.config.temperature,
      keepAlive: this.config.keepAlive
    })

    const options: StreamRequestOptions = {
      hostname: provider.apiHostname || "",
      port: provider.apiPort ? Number(provider.apiPort) : undefined,
      path: provider.apiPath || "",
      protocol: provider.apiProtocol || "",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: provider.apiKey ? `Bearer ${provider.apiKey}` : ""
      }
    }

    return { options, body }
  }

  private getProviderCompletionLast() {

    // 如果缓存存在，移除对应的提供者
    this._provider = this._provider?.filter((provider) => {
      const cacheKey = {
        prefix: this._prefixSuffix.prefix,
        suffix: `${this._prefixSuffix.suffix}-${provider.modelName}`
      };
  
      const completion = cache.getCache(cacheKey);
      if (completion != null && completion != undefined) {
        const item = this.provideInlineCompletion(provider, completion);
        if (item) {
          this._finalResults.push(item);
        } else {
          console.log("provideInlineCompletion returned null for provider:", provider.modelName);
        }
      }
  
      return cache.getCache(cacheKey) === null;
    });


  }

  public async provideInlineCompletionItems(
    document: TextDocument,
    position: Position,
    context: InlineCompletionContext
  ): Promise<InlineCompletionItem[] | InlineCompletionList | null | undefined> {
    const editor = window.activeTextEditor
    const providers = this.getFimProvider()
    if (!providers) return
    this._provider = Object.values(providers)

    console.log(`the turn console prin-- Provider count: ${this._provider.length}`);

    this._prefixSuffix = getPrefixSuffix(
      this.config.contextLength,
      document,
      position
    )

    const languageEnabled =
      this.config.enabledLanguages[document.languageId] ??
      this.config.enabledLanguages["*"] ??
      true

    if (!languageEnabled) {
      return
    }

    // 遍历提供者并尝试从缓存中获取补全项
    if (this.config.completionCacheEnabled) {
      this.getProviderCompletionLast();
      console.log("Final results from cache:", this._finalResults);
    }
    if (this._provider.length === 0) {
      console.log("No providers left, returning cached results.");
      return new InlineCompletionList(this._finalResults)
    }

    // 如果未启用，没有编辑器，或者应该跳过补全，或者字符串中间，则返回
    if (
      !this.config.enabled ||
      !editor ||
      getShouldSkipCompletion(context, this.config.autoSuggestEnabled) ||
      getIsMiddleOfString()
    ) {
      this._statusBar.text = "$(code)"
      return
    }

    this._chunkCount = 0
    this._document = document
    this._position = position
    this._nonce = this._nonce + 1
    this._statusBar.text = "$(loading~spin)"
    this._statusBar.command = "twinny.stopGeneration"
    await this.tryParseDocument(document)

    this._isMultilineCompletion = getIsMultilineCompletion({
      node: this._nodeAtPosition,
      prefixSuffix: this._prefixSuffix
    })

    if (this._debouncer) clearTimeout(this._debouncer)

    const results = await this.getResult();

    this._finalResults.concat(results)
    return new InlineCompletionList(this._finalResults); // 自动处理空数组情况
  }


  private onEnd(provider: TwinnyProvider, completion: string, resolve: (completion: ResolvedInlineCompletion) => void) {
    // 先获取结果
    const data = this.provideInlineCompletion(provider, completion);

    // 根据结果将结果作为参数传递给resolve
    resolve(data ? [data] : []);
  }

  private async getResult() {
    return new Promise<InlineCompletionItem[]>((resolve) => {
      this._debouncer = setTimeout(async () => {
        // 构造一个由 Promise 组成的数组
        const promiseArray = this._provider!.map(
          async (provider) => {
            return new Promise<ResolvedInlineCompletion>(async (resolve, reject) => {
              if (!provider) return

              const prompt = await this.getPrompt(provider, this._prefixSuffix)
              const request = this.buildFimRequest(prompt, provider)
              if (!request) return

              const localState: LocalState = {
                completion: "",
                chunkCount: 0,
                abortController: null,
                onDataNums: 0,
                nonce: this._nonce,
                position: this._position,
              };

              try {
                await llm({
                  body: request.body,
                  options: request.options,
                  onStart: (controller) => (localState.abortController = controller),
                  onEnd: () => this.onEnd(provider, localState.completion, resolve),
                  onError: () => this.onError(localState),
                  onData: (data) => {
                    const completion = this.onData(data as StreamResponse, localState, provider)
                    if (completion) {
                      localState.abortController?.abort()
                    }
                  }
                })
              } catch {
                this.onError(localState)
                reject([])
              }
            })
          });

        const settledResults = await Promise.allSettled(promiseArray)

        if (!settledResults) resolve([])

        // 过滤出成功的结果
        const validItems = settledResults
          .filter((result): result is { status: "fulfilled"; value: InlineCompletionItem[] | null } => result.status === "fulfilled")
          .map((result) => result.value)
          .filter((item) => item !== null);

        // 将二维数组展平为一维数组
        const getItems = validItems.flat();

        resolve(getItems);

      }, this.config.debounceDelay)
    })
  }

  private onData(data: StreamResponse | undefined, localState: LocalState, provider: TwinnyProvider): string {
    if (!provider) return ""

    // console.log("the turn is", localState.onDataNums += 1, provider.modelName, Date.now())

    const stopWords = getStopWords(
      provider.modelName,
      provider.fimTemplate || FIM_TEMPLATE_FORMAT.automatic
    )

    try {
      const providerFimData = getFimDataFromProvider(
        provider.provider,
        data
      )
      if (providerFimData === undefined) return ""

      localState.completion = localState.completion + providerFimData
      localState.chunkCount = localState.chunkCount + 1

      if (
        localState.completion.length > MAX_EMPTY_COMPLETION_CHARS &&
        localState.completion.trim().length === 0
      ) {
        localState.abortController?.abort()
        logger.log(
          `Streaming response end as llm in empty completion loop:  ${localState.nonce}`
        )
      }

      if (stopWords.some((stopWord) => localState.completion.includes(stopWord))) {
        return localState.completion
      }

      if (
        !this.config.multilineCompletionsEnabled &&
        localState.chunkCount >= MIN_COMPLETION_CHUNKS &&
        LINE_BREAK_REGEX.test(localState.completion.trimStart())
      ) {
        logger.log(
          `Streaming response end due to single line completion:  ${localState.nonce} \nCompletion: ${localState.completion}`
        )
        return localState.completion
      }


      const isMultilineCompletionRequired =
        !this._isMultilineCompletion &&
        this.config.multilineCompletionsEnabled &&
        localState.chunkCount >= MIN_COMPLETION_CHUNKS &&
        LINE_BREAK_REGEX.test(localState.completion.trimStart())
      if (isMultilineCompletionRequired) {
        logger.log(
          `Streaming response end due to multiline not required  ${localState.nonce} \nCompletion: ${localState.completion}`
        )
        return localState.completion
      }

      try {
        if (this._nodeAtPosition) {
          const takeFirst =
            MULTILINE_OUTSIDE.includes(this._nodeAtPosition?.type) ||
            (MULTILINE_INSIDE.includes(this._nodeAtPosition?.type) &&
              this._nodeAtPosition?.childCount > 2)


          const lineText = getCurrentLineText(localState.position) || ""
          const contextBeforeCompletion = this._prefixSuffix?.prefix || ""


          const isInsideFunction =
            contextBeforeCompletion.includes("=>") ||
            contextBeforeCompletion.includes("function") ||
            this._nodeAtPosition?.type.includes("function") ||
            this._nodeAtPosition?.type.includes("method") ||
            this._nodeAtPosition?.parent?.type.includes("function") ||
            this._nodeAtPosition?.parent?.type.includes("method");

          if (!this._parser) return ""

          if (providerFimData.includes("\n")) {
            const { rootNode } = this._parser.parse(
              `${lineText}${localState.completion}`
            )

            const { hasError } = rootNode

            const openBrackets: string[] = [];
            let isBalanced = true;

            for (const char of localState.completion) {
              if (OPENING_BRACKETS.includes(char as Bracket)) {
                openBrackets.push(char);
              } else if (CLOSING_BRACKETS.includes(char as Bracket)) {
                const lastOpen = openBrackets.pop();

                if (!lastOpen || !this.isMatchingBracket(lastOpen as Bracket, char)) {
                  isBalanced = false;
                  break;
                }
              }
            }

            const hasSubstantialContent = localState.completion.trim().length > 20;
            const hasCompleteSyntax = openBrackets.length === 0 && isBalanced;

            const hasEndPattern = /\}\s*$|\)\s*$|\]\s*$|;\s*$/.test(localState.completion);

            const endsWithEmptyLine = /\n\s*\n\s*$/.test(localState.completion);

            const lines = localState.completion.split("\n");
            const lastLineIndent = lines.length > 1 ?
              lines[lines.length - 1].length - lines[lines.length - 1].trimStart().length : 0;
            const firstLineIndent = lines.length > 0 ?
              lines[0].length - lines[0].trimStart().length : 0;
            const indentationReturned = lines.length > 2 && lastLineIndent <= firstLineIndent;

            const structuralBoundaryPattern = /\}\s*\n(\s*)\S+/m.test(localState.completion);

            if (isInsideFunction && localState.completion.includes("}")) {
              const lastClosingBraceIndex = localState.completion.lastIndexOf("}");

              if (hasCompleteSyntax) {
                const contentAfterBrace = localState.completion.substring(lastClosingBraceIndex + 1).trim();

                if (!contentAfterBrace || /^\s*\n\s*\S+/.test(contentAfterBrace)) {
                  localState.completion = localState.completion.substring(0, lastClosingBraceIndex + 1);
                  logger.log(
                    `Trimmed completion at function end: ${localState.nonce} \nCompletion: ${localState.completion}`
                  )
                  return localState.completion;
                }
              }
            }

            if (structuralBoundaryPattern && hasCompleteSyntax) {
              const match = localState.completion.match(/\}\s*\n(\s*)\S+/m);
              if (match && match.index !== undefined) {
                const closingBracePos = match.index + 1;

                const indentAfterBrace = match[1].length;
                if (indentAfterBrace <= firstLineIndent) {
                  localState.completion = localState.completion.substring(0, closingBracePos);
                  logger.log(
                    `Trimmed completion at structural boundary: ${localState.nonce} \nCompletion: ${localState.completion}`
                  )
                  return localState.completion;
                }
              }
            }

            if (
              this._parser &&
              this._nodeAtPosition &&
              this._isMultilineCompletion &&
              localState.chunkCount >= 2 &&
              (takeFirst || hasCompleteSyntax) &&
              !hasError &&
              (hasEndPattern || endsWithEmptyLine || indentationReturned ||
                (hasSubstantialContent && hasCompleteSyntax))
            ) {
              if (
                MULTI_LINE_DELIMITERS.some((delimiter) =>
                  localState.completion.endsWith(delimiter)
                ) ||
                endsWithEmptyLine ||
                (hasEndPattern && hasCompleteSyntax) ||
                (structuralBoundaryPattern && hasCompleteSyntax)
              ) {
                logger.log(
                  `Streaming response end due to completion detection ${localState.nonce} \nCompletion: ${localState.completion}`
                )
                return localState.completion
              }
            }
          }
        }
      } catch (e) {
        console.error(e)
        localState.abortController?.abort()
      }

      if (getLineBreakCount(localState.completion) >= this.config.maxLines) {
        logger.log(
          `Streaming response end due to max line count ${localState.nonce} \nCompletion: ${localState.completion}`
        )
        return localState.completion
      }

      return ""
    } catch (e) {
      console.error(e)
      return ""
    }
  }

  private async tryParseDocument(document: TextDocument) {
    try {
      if (!this._position || !this._document) return
      const parser = await getParser(document.uri.fsPath)

      if (!parser || !parser.parse) return

      this._parser = parser

      this._nodeAtPosition = getNodeAtPosition(
        this._parser?.parse(this._document.getText()),
        this._position
      )
    } catch {
      return
    }
  }

  private isMatchingBracket(open: Bracket, close: string): boolean {
    const pairs: Record<Bracket, string> = {
      "(": ")",
      "[": "]",
      "{": "}"
    };
    return pairs[open] === close;
  }

  public onError = (localState: LocalState) => {
    localState.abortController?.abort()
  }

  private getPromptHeader(languageId: string | undefined, uri: Uri) {
    const lang =
      supportedLanguages[languageId as keyof typeof supportedLanguages]

    if (!lang) {
      return ""
    }

    const language = `${lang.syntaxComments?.start || ""} Language: ${lang?.langName
      } (${languageId}) ${lang.syntaxComments?.end || ""}`

    const path = `${lang.syntaxComments?.start || ""
      } File uri: ${uri.toString()} (${languageId}) ${lang.syntaxComments?.end || ""
      }`

    return `\n${language}\n${path}\n`
  }

  private async getRelevantDocuments(): Promise<RepositoryDocment[]> {
    const interactions = this._fileInteractionCache.getAll()
    const currentFileName = this._document?.fileName || ""
    const openTextDocuments = workspace.textDocuments
    const rootPath = workspace.workspaceFolders?.[0]?.uri.fsPath || ""
    const ig = ignore({ allowRelativePaths: true })

    const embeddingIgnoredGlobs = this.config.get(
      "embeddingIgnoredGlobs",
      [] as string[]
    )

    ig.add(embeddingIgnoredGlobs)

    const gitIgnoreFilePath = path.join(rootPath, ".gitignore")

    if (fs.existsSync(gitIgnoreFilePath)) {
      ig.add(fs.readFileSync(gitIgnoreFilePath).toString())
    }

    const openDocumentsData: RepositoryDocment[] = openTextDocuments
      .filter((doc) => {
        const isCurrentFile = doc.fileName === currentFileName
        const isGitFile =
          doc.fileName.includes(".git") || doc.fileName.includes("git/")

        const projectRoot = workspace.workspaceFolders?.[0].uri.fsPath || ""
        const relativePath = path.relative(projectRoot, doc.fileName)

        if (isGitFile) return false

        const normalizedPath = relativePath.split(path.sep).join("/")
        const isIgnored = ig.ignores(normalizedPath)

        return !isCurrentFile && !isIgnored
      })
      .map((doc) => {
        const interaction = interactions.find((i) => i.name === doc.fileName)
        return {
          uri: doc.uri,
          text: doc.getText(),
          name: doc.fileName,
          isOpen: true,
          relevanceScore: interaction?.relevanceScore || 0
        }
      })

    const otherDocumentsData: RepositoryDocment[] = (
      await Promise.all(
        interactions
          .filter(
            (interaction) =>
              !openTextDocuments.some(
                (doc) => doc.fileName === interaction.name
              )
          )
          .filter((interaction) => !ig.ignores(interaction.name || ""))
          .map(async (interaction) => {
            const filePath = interaction.name
            if (!filePath) return null
            if (
              filePath.toString().match(".git") ||
              currentFileName === filePath
            )
              return null
            const uri = Uri.file(filePath)
            try {
              const document = await workspace.openTextDocument(uri)
              return {
                uri,
                text: document.getText(),
                name: filePath,
                isOpen: false,
                relevanceScore: interaction.relevanceScore
              }
            } catch (error) {
              console.error(`Error opening document ${filePath}:`, error)
              return null
            }
          })
      )
    ).filter((doc): doc is RepositoryDocment => doc !== null)

    const allDocuments = [...openDocumentsData, ...otherDocumentsData].sort(
      (a, b) => b.relevanceScore - a.relevanceScore
    )

    return allDocuments.slice(0, 3)
  }

  private async getFileInteractionContext() {
    this._fileInteractionCache.addOpenFilesWithPriority()
    const interactions = this._fileInteractionCache.getAll()
    const currentFileName = this._document?.fileName || ""

    const fileChunks: string[] = []
    for (const interaction of interactions) {
      const filePath = interaction.name

      if (!filePath) continue
      if (filePath.toString().match(".git")) continue
      if (currentFileName === filePath) continue

      const uri = Uri.file(filePath)
      const activeLines = interaction.activeLines

      let document;
      try {
        document = await workspace.openTextDocument(uri)
      } catch {
        continue
      }

      const lineCount = document.lineCount
      if (lineCount > MAX_CONTEXT_LINE_COUNT) {
        const averageLine =
          activeLines.reduce((acc, curr) => acc + curr.line, 0) /
          activeLines.length
        const start = new Position(
          Math.max(0, Math.ceil(averageLine || 0) - 100),
          0
        )
        const end = new Position(
          Math.min(lineCount, Math.ceil(averageLine || 0) + 100),
          0
        )
        fileChunks.push(
          `
          // File: ${filePath}
          // Content: \n ${document.getText(new Range(start, end))}
        `.trim()
        )
      } else {
        fileChunks.push(
          `
          // File: ${filePath}
          // Content: \n ${document.getText()}
        `.trim()
        )
      }
    }

    return fileChunks.join("\n")
  }

  private removeStopWords(provider: TwinnyProvider, completion: string) {
    if (!provider) return completion
    let filteredCompletion = completion
    const stopWords = getStopWords(
      provider.modelName,
      provider.fimTemplate || FIM_TEMPLATE_FORMAT.automatic
    )
    stopWords.forEach((stopWord) => {
      filteredCompletion = filteredCompletion.split(stopWord).join("")
    })
    return filteredCompletion
  }

  private async getPrompt(provider: TwinnyProvider, prefixSuffix: PrefixSuffix) {
    if (!provider) return ""
    if (!this._document || !this._position || !provider) return ""

    const documentLanguage = this._document.languageId
    const fileInteractionContext = await this.getFileInteractionContext()

    if (provider.fimTemplate === FIM_TEMPLATE_FORMAT.custom) {
      const systemMessage =
        await this._templateProvider.readSystemMessageTemplate("fim-system.hbs")

      const fimTemplate =
        await this._templateProvider.readTemplate<FimTemplateData>("fim", {
          prefix: prefixSuffix.prefix,
          suffix: prefixSuffix.suffix,
          systemMessage,
          context: fileInteractionContext || "",
          fileName: this._document.uri.fsPath,
          language: documentLanguage
        })

      if (fimTemplate) {
        this._usingFimTemplate = true
        return fimTemplate
      }
    }

    if (provider.repositoryLevel) {
      const repositoryLevelData = await this.getRelevantDocuments()
      const repoName = workspace.name
      const currentFile = await this._document.uri.fsPath
      return getFimTemplateRepositoryLevel(
        repoName || "untitled",
        repositoryLevelData,
        prefixSuffix,
        currentFile
      )
    }

    return getFimPrompt(
      provider.modelName,
      provider.fimTemplate || FIM_TEMPLATE_FORMAT.automatic,
      {
        context: fileInteractionContext || "",
        prefixSuffix,
        header: this.getPromptHeader(documentLanguage, this._document.uri),
        fileContextEnabled: this.config.fileContextEnabled,
        language: documentLanguage
      }
    )
  }

  public setAcceptedLastCompletion(value: boolean) {
    this._acceptedLastCompletion = value
    this._lastCompletionMultiline = getLineBreakCount(this._completion) > 1
  }

  public abortCompletion() {
    this._abortController?.abort()
    this._statusBar.text = "$(code)"
  }

  private logCompletion(formattedCompletion: string) {
    logger.log(
      `
      *** Twinny completion triggered for file: ${this._document?.uri} ***
      Original completion: ${this._completion}
      Formatted completion: ${formattedCompletion}
      Max Lines: ${this.config.maxLines}
      Use file context: ${this.config.fileContextEnabled}
      Completed lines count ${getLineBreakCount(formattedCompletion)}
      Using custom FIM template fim.bhs?: ${this._usingFimTemplate}
    `.trim()
    )
  }

  private provideInlineCompletion(provider: TwinnyProvider, completion: string): InlineCompletionItem | null {
    const editor = window.activeTextEditor;
    if (!editor || !this._position) return null; // 直接返回 null，而不是 []

    // 先移除停止词，再格式化补全内容
    const filteredCompletion = this.removeStopWords(provider, completion);
    const formattedCompletion = new CompletionFormatter(editor).format(filteredCompletion);

    // 记录日志
    this.logCompletion(formattedCompletion);

    // 缓存处理，增加模型 ID 避免不同模型的补全内容互相影响
    if (this.config.completionCacheEnabled) {
      // 构造包含模型名称的 PrefixSuffix
      const cachePrefixSuffix: PrefixSuffix = {
        prefix: this._prefixSuffix.prefix,
        suffix: `${this._prefixSuffix.suffix}-${provider.modelName}`
      };

      // 使用构造的 PrefixSuffix 作为缓存键
      cache.setCache(cachePrefixSuffix, formattedCompletion);
    }

    // 状态更新
    this._statusBar.text = "$(code)"
    this.lastCompletionText = formattedCompletion
    this._lastCompletionMultiline = getLineBreakCount(formattedCompletion) > 1;

    return new InlineCompletionItem(
      formattedCompletion,
      new Range(this._position, this._position)
    );
  }
}
