import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  VSCodeDropdown,
  VSCodeOption,
  VSCodeTextField} from "@vscode/webview-ui-toolkit/react"

import { API_PROVIDERS, GLOBAL_STORAGE_KEY,PROVIDER_EVENT_NAME } from "../common/constants"
import { SymmetryModelProvider } from "../common/types"

import { useGlobalContext, useModels, useOllamaModels, useProviders, useSymmetryConnection } from "./hooks"

import styles from "./styles/providers.module.css"
import { TwinnyProvider } from "../extention/serve_func/provider-manager"

// Simple loader component for model loading
const ModelLoader = () => {
  const { t } = useTranslation()
  const [dots, setDots] = useState("")

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prevDots) => {
        switch (prevDots) {
          case "":
            return "."
          case ".":
            return ".."
          case "..":
            return "..."
          default:
            return ""
        }
      })
    }, 500)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className={styles.modelLoader}>
      <span className={styles.loaderText}>{t("Loading models")}{dots}</span>
    </div>
  )
}

export const ProviderSelect = () => {
  const { t } = useTranslation()
  const ollamaModels = useOllamaModels()
  const { models } = useModels()
  const { providers: symmetryProviders } = useSymmetryConnection()
  const { getProvidersByType, setActiveChatProvider, providers, chatProvider } =
    useProviders()

  const chatProviders = Object.values(getProvidersByType("chat"))
    .sort((a, b) => a.modelName.localeCompare(b.modelName))

  const isActiveProviderInList = chatProvider && chatProviders.some(p => p.id === chatProvider.id)
  const effectiveProvider = isActiveProviderInList ? chatProvider : (chatProviders[0] || null)
  // 新增状态来存储当前选择的 provider
  const [selectedProvider, setSelectedProvider] = useState<TwinnyProvider | null>(null);

  React.useEffect(() => {
    if (!selectedProvider && effectiveProvider) {
      setSelectedProvider(effectiveProvider);
    }
    if (chatProvider && !isActiveProviderInList && chatProviders.length > 0) {
      const firstProvider = chatProviders[0]

      const defaultModel = models[firstProvider.provider as keyof typeof models]?.models?.[0] || firstProvider.modelName
      setActiveChatProvider({
        ...firstProvider,
        modelName: defaultModel
      })
    }
  }, [chatProvider, chatProviders, isActiveProviderInList])

  const providerModels =
    effectiveProvider?.provider === API_PROVIDERS.Ollama
      ? ollamaModels.models?.map(({ name }) => name) || []
      : effectiveProvider?.provider === API_PROVIDERS.Twinny
        ? symmetryProviders.map((provider: SymmetryModelProvider) => provider.model_name) || []
        : models[effectiveProvider?.provider as keyof typeof models]?.models || []

  const {
    context: selectedModel,
    setContext: setSelectedModel
  } = useGlobalContext<string>(GLOBAL_STORAGE_KEY.selectedModel)

  const{
    context: chosenModels,
    setContext: setChosenModels
  }=useGlobalContext<Record<string, TwinnyProvider>>(GLOBAL_STORAGE_KEY.chosenModels)

 

  const handleChangeChatProvider = (e: unknown): void => {
    const event = e as React.ChangeEvent<HTMLSelectElement>
    const value = event.target.value
    const provider = providers[value]
    const defaultModel = models[provider.provider as keyof typeof models]?.models?.[0] || provider.modelName
    setSelectedModel(defaultModel)
    setChosenModels({ [defaultModel]: provider })
    setActiveChatProvider({
      ...provider,
      modelName: defaultModel
    })
    setSelectedProvider(provider)
  }

  return (
    <div className={styles.providerSelector}>
      <div>
        <VSCodeDropdown
          value={effectiveProvider?.id || ""}
          name="provider"
          onChange={handleChangeChatProvider}
        >
          {chatProviders.map((provider, index) => (
            <VSCodeOption key={index} value={provider.id}>
              {provider.label}
            </VSCodeOption>
          ))}
        </VSCodeDropdown>
      </div>
      <div>
        {effectiveProvider?.id && providerModels.length > 0 ? (
          <VSCodeDropdown
            multiple
            // value={selectedModel || providerModels[0] || ""}
            value={chosenModels || providerModels[0] || ""}
            name="model"
            onChange={(e: unknown) => {
              const event = e as React.ChangeEvent<HTMLSelectElement>
              const selectedOptions=Array.from(event.target.selectedOptions)
              const selectedValues=selectedOptions.map((option) => option.value)
              const updatedChosenModels: Record<string, TwinnyProvider> = {}
              selectedValues.forEach(model => {
                const provider = selectedProvider!
                console.log("selectedprovider", provider)
                const newActiveProvider = { ...provider, modelName: model };
                setActiveChatProvider(newActiveProvider);
                updatedChosenModels[model] = newActiveProvider;
              })
              console.log("updatedChosenModels", updatedChosenModels)
              setSelectedModel(event.target.value)
              setChosenModels(updatedChosenModels)
              console.log("selectedValues", selectedValues)
              console.log("chosenModels", updatedChosenModels)
              
              if (effectiveProvider) {
                setActiveChatProvider({
                  ...effectiveProvider,
                  modelName: event.target.value
                })
              }
    
            }}
          >
             { providerModels.map((model:string,index:number)=>(
                <VSCodeOption key={index} value={model}>
                  {model}
                </VSCodeOption>
              )
            )}
          </VSCodeDropdown>
        ) : effectiveProvider?.provider === API_PROVIDERS.Twinny && symmetryProviders.length === 0 ? (
          <ModelLoader />
        ) : (
            <VSCodeTextField
            value={chosenModels ? Object.keys(chosenModels).join(", ") : ""}
            placeholder={t("Enter model names, separated by commas")}
            onChange={(e: unknown) => {
              const event = e as React.ChangeEvent<HTMLInputElement>;
              const value = event.target.value.trim();
              if (!value) return;
              const modelArray = value.split(",").map(model => model.trim());
              const updatedChosenModels: Record<string, TwinnyProvider> = {}
              modelArray.forEach(model => {
                const provider = selectedProvider!
                const newActiveProvider = { ...provider, modelName: model };
                setActiveChatProvider(newActiveProvider);
                updatedChosenModels[model] = newActiveProvider;
              })
              setChosenModels(updatedChosenModels);
              console.log("setchosenModels modelArray", updatedChosenModels)
              if (effectiveProvider) {
                setActiveChatProvider({
                  ...effectiveProvider,
                  modelName: event.target.value
                })
              }
            }}
          />
        )}
      </div>
    </div>
  )
}
