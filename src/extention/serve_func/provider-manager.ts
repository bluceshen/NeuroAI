import { ReactNode } from "react"
import { v4 as uuidv4 } from "uuid"
import { ExtensionContext, Webview } from "vscode"
// *
import {
  ACTIVE_CHAT_PROVIDER_STORAGE_KEY,
  ACTIVE_EMBEDDINGS_PROVIDER_STORAGE_KEY,
  ACTIVE_FIM_PROVIDER_STORAGE_KEY,
  API_PROVIDERS,
  EVENT_NAME,
  FIM_TEMPLATE_FORMAT,
  GLOBAL_STORAGE_KEY,
  INFERENCE_PROVIDERS_STORAGE_KEY,
  PROVIDER_EVENT_NAME,
  WEBUI_TABS
} from "../../common/constants"
import { ClientMessage, ServerMessage } from "../../common/types"

export interface TwinnyProvider {
  apiHostname?: string
  apiKey?: string
  apiPath?: string
  apiPort?: number
  apiProtocol?: string
  features?: string[]
  fimTemplate?: string
  id: string
  label: string
  logo?: ReactNode
  modelName: string
  provider: string
  repositoryLevel?: boolean
  type: string
}

type Providers = Record<string, TwinnyProvider> | undefined
// 定义 chosenModels 的类型
type ChosenModels = string[];
export class ProviderManager {
  _context: ExtensionContext
  _webView: Webview

  constructor(context: ExtensionContext, webviewView: Webview) {
    this._context = context
    this._webView = webviewView
    this.setUpEventListeners()
    this.addDefaultProviders()
  }

  setUpEventListeners() {
    this._webView?.onDidReceiveMessage(
      (message: ClientMessage<TwinnyProvider>) => {
        this.handleMessage(message)
        console.log("provider manager received message", message)
      },


    )
  }
 

  handleMessage(message: ClientMessage<TwinnyProvider &  { key?: string; data?: ChosenModels }| TwinnyProvider[]>) {
    const { data: provider } = message
    switch (message.type) {
      case PROVIDER_EVENT_NAME.addProvider:
        if(Array.isArray(provider)) return;
        return this.addProvider(provider) // ok
      case PROVIDER_EVENT_NAME.removeProvider:
        if(Array.isArray(provider)) return;
        return this.removeProvider(provider)  // ok
      case PROVIDER_EVENT_NAME.updateProvider:
        if(Array.isArray(provider)) return;
        return this.updateProvider(provider)  // ok
      case PROVIDER_EVENT_NAME.getActiveChatProvider:
        if(Array.isArray(provider)) return;
        return this.getActiveChatProvider()
      case PROVIDER_EVENT_NAME.getActiveFimProvider:
        return this.getActiveFimProvider()   // ok
      case PROVIDER_EVENT_NAME.getActiveEmbeddingsProvider:
        return this.getActiveEmbeddingsProvider()
      case PROVIDER_EVENT_NAME.setActiveChatProvider:
        if(Array.isArray(provider)) return;
        return this.setActiveChatProvider(provider)
      case PROVIDER_EVENT_NAME.setActiveFimProvider:
        return this.setActiveFimProvider(provider) // ok
      case PROVIDER_EVENT_NAME.setActiveEmbeddingsProvider:
        if(Array.isArray(provider)) return;
        return this.setActiveEmbeddingsProvider(provider)
      case PROVIDER_EVENT_NAME.copyProvider:
        if(Array.isArray(provider)) return;
        return this.copyProvider(provider)  // ok
      case PROVIDER_EVENT_NAME.getAllProviders:
        return this.getAllProviders()
      case PROVIDER_EVENT_NAME.resetProvidersToDefaults:
        return this.resetProvidersToDefaults()
      case 'twinny-set-global-context':
        if(message.key=="twinny.chosenModels"){
          this._context.globalState.update(message.key, message.data)
        }

        // const providers =  this._context.globalState.get(`${EVENT_NAME.twinnyGlobalContext}-${GLOBAL_STORAGE_KEY.selectedModel}`)

        console.log("chosen models", this._context.globalState.get("twinny.chosenModels"))
        console.log("selected model", this._context.globalState.get(`${EVENT_NAME.twinnyGlobalContext}-${GLOBAL_STORAGE_KEY.selectedModel}`))
    }
  }

  public focusProviderTab = () => {
    this._webView.postMessage({
      type: PROVIDER_EVENT_NAME.focusProviderTab,
      data: WEBUI_TABS.providers
    } as ServerMessage<string>)
  }

  getDefaultChatProvider() {
    return {
      apiHostname: "0.0.0.0",
      apiPath: "/v1",
      apiPort: 11434,
      apiProtocol: "http",
      id: uuidv4(),
      label: "OpenAI Compatible (localhost)",
      modelName: "codellama:7b-instruct",
      provider: API_PROVIDERS.Ollama,
      type: "chat",
    } as TwinnyProvider
  }

  getDefaultEmbeddingsProvider() {
    return {
      apiHostname: "0.0.0.0",
      apiPath: "/api/embed",
      apiPort: 11434,
      apiProtocol: "http",
      id: uuidv4(),
      label: "Ollama Embedding",
      modelName: "all-minilm:latest",
      provider: API_PROVIDERS.Ollama,
      type: "embedding"
    } as TwinnyProvider
  }

  // 获取默认补全填充提供者
  getDefaultFimProvider() {
    const provider1 = {
      apiHostname: "0.0.0.0",
      apiPath: "/api/generate",
      apiPort: 11434,
      apiProtocol: "http",
      fimTemplate: FIM_TEMPLATE_FORMAT.codellama,
      label: "Ollama FIM",
      id: uuidv4(),
      modelName: "codellama:7b-code",
      provider: API_PROVIDERS.Ollama,
      type: "fim"
    } as TwinnyProvider

    return provider1
  }

  addDefaultProviders() {
    this.addDefaultChatProvider()
    this.addDefaultFimProvider()
    this.addDefaultEmbeddingsProvider()
  }

  // 给定providers数组，返回Record
  createProvidersRecord(providers: TwinnyProvider[]): Providers {
    if (providers.length === 0) {
      return undefined;
    }

    return providers.reduce((acc, prov) => {
      acc[prov.id] = prov;
      return acc;
    }, {} as Record<string, TwinnyProvider>);
  }

  addDefaultChatProvider(): TwinnyProvider {
    const provider = this.getDefaultChatProvider()
    if (!this._context.globalState.get(ACTIVE_CHAT_PROVIDER_STORAGE_KEY)) {
      this.addDefaultProvider(provider)
    }
    return provider
  }

  addDefaultFimProvider(): TwinnyProvider {
    const provider = this.getDefaultFimProvider()
    if (!this._context.globalState.get(ACTIVE_FIM_PROVIDER_STORAGE_KEY)) {
      this.addDefaultProvider(provider)
    }
    return provider
  }

  addDefaultEmbeddingsProvider(): TwinnyProvider {
    const provider = this.getDefaultEmbeddingsProvider()

    if (
      !this._context.globalState.get(ACTIVE_EMBEDDINGS_PROVIDER_STORAGE_KEY)
    ) {
      this.addDefaultProvider(provider)
    }
    return provider
  }

  addDefaultProvider(provider: TwinnyProvider): void {
    if (provider.type === "chat") {
      this._context.globalState.update(
        ACTIVE_CHAT_PROVIDER_STORAGE_KEY,
        provider
      )
    } else if (provider.type === "fim") {
      // 修改保存的项，使得保存的是 Providers
      const prov = this.createProvidersRecord([provider])
      this._context.globalState.update(
        ACTIVE_FIM_PROVIDER_STORAGE_KEY,
        prov
      )
    } else {
      this._context.globalState.update(
        ACTIVE_EMBEDDINGS_PROVIDER_STORAGE_KEY,
        provider
      )
    }
    this.addProvider(provider)
  }

  getProviders(): Providers {
    const providers = this._context.globalState.get<
      Record<string, TwinnyProvider>
    >(INFERENCE_PROVIDERS_STORAGE_KEY)
    return providers
  }

  getAllProviders() {
    const providers = this.getProviders() || {}
    this._webView?.postMessage({
      type: PROVIDER_EVENT_NAME.getAllProviders,
      data: providers
    })
  }

  getActiveChatProvider() {
    const provider = this._context.globalState.get<TwinnyProvider>(
      ACTIVE_CHAT_PROVIDER_STORAGE_KEY
    )
    this._webView?.postMessage({
      type: PROVIDER_EVENT_NAME.getActiveChatProvider,
      data: provider
    })
    return provider
  }



  // 修改返回类型为Providers
  getActiveFimProvider() {
    const provider = this._context.globalState.get<Providers>(
      ACTIVE_FIM_PROVIDER_STORAGE_KEY
    )
    this._webView?.postMessage({
      type: PROVIDER_EVENT_NAME.getActiveFimProvider,
      data: provider
    })
    return provider
  }

  getActiveEmbeddingsProvider() {
    const provider = this._context.globalState.get<TwinnyProvider>(
      ACTIVE_EMBEDDINGS_PROVIDER_STORAGE_KEY
    )
    this._webView?.postMessage({
      type: PROVIDER_EVENT_NAME.getActiveEmbeddingsProvider,
      data: provider
    })
    return provider
  }

  setActiveChatProvider(provider?: TwinnyProvider) {
    if (!provider) return
    this._context.globalState.update(ACTIVE_CHAT_PROVIDER_STORAGE_KEY, provider)
    return this.getActiveChatProvider()
  }

  // 将provider的修改同步到Record中
  setActiveFimProvider(provider?: TwinnyProvider | TwinnyProvider[]) {
    if (!provider) return

    if(Array.isArray(provider)) {
      const data = this.createProvidersRecord(provider);
      this._context.globalState.update(ACTIVE_FIM_PROVIDER_STORAGE_KEY, data)
      return this.getActiveFimProvider()
    }

    const providers = this.getActiveFimProvider() || {}
    providers[provider.id] = provider;
    this._context.globalState.update(ACTIVE_FIM_PROVIDER_STORAGE_KEY, providers)
    return this.getActiveFimProvider()
  }

  setActiveEmbeddingsProvider(provider?: TwinnyProvider) {
    if (!provider) return
    this._context.globalState.update(
      ACTIVE_EMBEDDINGS_PROVIDER_STORAGE_KEY,
      provider
    )
    return this.getActiveEmbeddingsProvider()
  }

  addProvider(provider?: TwinnyProvider) {
    const providers = this.getProviders() || {}
    if (!provider) return
    provider.id = uuidv4()
    providers[provider.id] = provider
    this._context.globalState.update(INFERENCE_PROVIDERS_STORAGE_KEY, providers)

    if (provider.type === "chat") {
      this._context.globalState.update(
        `${EVENT_NAME.twinnyGlobalContext}-${GLOBAL_STORAGE_KEY.selectedModel}`,
        provider?.modelName
      )
    }

    this.getAllProviders()
  }

  copyProvider(provider?: TwinnyProvider) {
    if (!provider) return
    provider.id = uuidv4()
    provider.label = `${provider.label}-copy`
    this.addProvider(provider)
  }

  removeProvider(provider?: TwinnyProvider) {
    const providers = this.getProviders() || {}
    if (!provider) return
    delete providers[provider.id]
    this._context.globalState.update(INFERENCE_PROVIDERS_STORAGE_KEY, providers)
    this.getAllProviders()
  }

  updateProvider(provider?: TwinnyProvider) {
    const providers = this.getProviders() || {}
    const activeFimProvider = this.getActiveFimProvider()
    const activeChatProvider = this.getActiveChatProvider()
    const activeEmbeddingsProvider = this.getActiveEmbeddingsProvider()

    if (!provider) return

    providers[provider.id] = provider
    this._context.globalState.update(INFERENCE_PROVIDERS_STORAGE_KEY, providers)

    // 如果填充提供者不为空，且现有的提供者位于提供者里面
    if (activeFimProvider && Object.values(activeFimProvider).some(prov => prov.id === provider.id))
      this.setActiveFimProvider(provider)
    if (provider.id === activeChatProvider?.id)
      this.setActiveChatProvider(provider)
    if (provider.id === activeEmbeddingsProvider?.id)
      this.setActiveEmbeddingsProvider(provider)
    this.getAllProviders()
  }

  resetProvidersToDefaults(): void {
    this._context.globalState.update(INFERENCE_PROVIDERS_STORAGE_KEY, undefined)
    this._context.globalState.update(
      ACTIVE_CHAT_PROVIDER_STORAGE_KEY,
      undefined
    )
    this._context.globalState.update(
      ACTIVE_EMBEDDINGS_PROVIDER_STORAGE_KEY,
      undefined
    )
    this._context.globalState.update(ACTIVE_FIM_PROVIDER_STORAGE_KEY, undefined)
    const chatProvider = this.addDefaultChatProvider()
    const fimProvider = this.addDefaultFimProvider()
    const embeddingsProvider = this.addDefaultEmbeddingsProvider()
    this.focusProviderTab()
    this.setActiveChatProvider(chatProvider)
    this.setActiveFimProvider(fimProvider)
    this.setActiveEmbeddingsProvider(embeddingsProvider)
    this.getAllProviders()
  }
}
