import path from "path"
import { Position } from "vscode"
import Parser, { SyntaxNode } from "web-tree-sitter"

import { WASM_LANGUAGES } from "../../common/constants"

// 缓存已加载的解析器
const parserCache: { [language: string]: Parser } = {}

let isInitialized = false // 标记解析器是否已初始化

// 获取解析器的异步函数
export const getParser = async (
  filePath: string // 文件路径
): Promise<Parser | undefined> => { 
  try {
    // 如果解析器尚未初始化，则进行初始化
    if (!isInitialized) {
      await Parser.init()
      isInitialized = true
    }

    // 获取文件扩展名并查找对应的语言
    const fileExtension = path.extname(filePath).slice(1)
    const language = WASM_LANGUAGES[fileExtension]

    if (!language) return undefined // 如果没有找到对应语言，返回 undefined

    // 如果解析器已缓存，直接返回
    if (parserCache[language]) {
      return parserCache[language]
    }

    // 创建新的解析器实例
    const parser = new Parser()
    // 加载对应语言的 WebAssembly 模块
    const wasmPath = path.join(
      __dirname,
      "tree-sitter-wasms",
      `tree-sitter-${language}.wasm`
    )
    const parserLanguage = await Parser.Language.load(wasmPath) // 加载语言
    parser.setLanguage(parserLanguage) // 设置解析器语言

    // 缓存解析器并返回
    parserCache[language] = parser
    return parser
  } catch (e) {
    console.error("Error in getParser:", e) // 处理错误
    throw e
  }
}

// 根据位置获取语法节点的函数
export function getNodeAtPosition(
  tree: Parser.Tree | undefined, // 解析树
  position: Position // 位置
): SyntaxNode | null {
  let foundNode: SyntaxNode | null = null // 找到的节点
  const visitedNodes: SyntaxNode[] = [] // 访问过的节点
  if (!tree || !position) {
    return null // 如果树或位置无效，返回 null
  }

  // 递归搜索节点的内部函数
  function searchNode(node: SyntaxNode): boolean {
    // 检查当前节点是否包含目标位置
    if (
      position.line >= node.startPosition.row &&
      position.line <= node.endPosition.row
    ) {
      foundNode = node // 找到节点
      for (const child of node.children) {
        visitedNodes.push(child) // 记录访问的子节点
        if (searchNode(child)) break // 递归搜索子节点
      }
      return true // 找到节点，返回 true
    }
    return false // 未找到节点，返回 false
  }

  searchNode(tree.rootNode) // 从根节点开始搜索

  return foundNode // 返回找到的节点
}
