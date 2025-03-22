import * as ort from "onnxruntime-web"
import * as path from "path"
import { Toxe } from "toxe"

import { logger } from "../../common/logger"

// 设置 ONNX Runtime Web 的线程数为 1
ort.env.wasm.numThreads = 1

export class Reranker {
  private _tokenizer: Toxe | null = null // 分词器
  private _session: ort.InferenceSession | null = null // ONNX 推理会话
  private readonly _modelPath: string // 模型路径
  private readonly _tokenizerPath: string // 分词器路径

  constructor() {
    // 初始化模型和分词器的路径
    this._modelPath = path.join(__dirname, "..", "models", "reranker.onnx")
    this._tokenizerPath = path.join(__dirname, "..", "models", "spm.model")
    this.init() // 初始化
  }

  // 初始化方法
  public async init(): Promise<void> {
    try {
      // 并行加载模型和分词器
      await Promise.all([this.loadModel(), this.loadTokenizer()])
      logger.log("Reranker initialized successfully") // 初始化成功日志
    } catch (error) {
      console.error(error) // 处理错误
    }
  }

  // 重新排序方法
  public async rerank(
    sample: string, // 输入样本
    samples: string[] // 待排序的样本数组
  ): Promise<number[] | undefined> {
    // 对输入样本和待排序样本进行编码
    const ids = await this._tokenizer?.encode(sample, samples)
    if (!ids?.length) return undefined // 如果编码失败，返回 undefined

    // 获取输入张量和注意力掩码张量
    const inputTensor = this.getInputTensor(ids, samples.length)
    const attentionMaskTensor = this.getOutputTensor(
      ids.length,
      samples.length
    )

    // 运行模型进行推理
    const output = await this._session?.run({
      input_ids: inputTensor,
      attention_mask: attentionMaskTensor,
    })

    if (!output) return undefined // 如果输出为空，返回 undefined

    // 获取 logits 并进行 softmax 归一化
    const logits = await this.getLogits(output)
    const normalizedProbabilities = this.softmax(logits)

    // 打印重新排序后的样本及其概率
    logger.log(
      `Reranked samples: \n${this.formatResults(
        samples,
        normalizedProbabilities
      )}`
    )
    return normalizedProbabilities // 返回归一化的概率
  }

  // 获取输入张量
  private getInputTensor(ids: number[], sampleCount: number): ort.Tensor {
    const inputIds = ids.map(BigInt) // 将 ids 转换为 BigInt
    return new ort.Tensor("int64", BigInt64Array.from(inputIds), [
      sampleCount,
      inputIds.length / sampleCount,
    ])
  }

  // 获取输出张量（注意力掩码）
  private getOutputTensor(
    inputLength: number,
    sampleCount: number
  ): ort.Tensor {
    return new ort.Tensor("int64", new BigInt64Array(inputLength).fill(1n), [
      sampleCount,
      inputLength / sampleCount,
    ])
  }

  // 获取 logits
  private async getLogits(
    output: ort.InferenceSession.OnnxValueMapType
  ): Promise<number[]> {
    const data = await output.logits.getData() // 获取 logits 数据
    const logits = Array.prototype.slice.call(data) // 转换为数组
    return logits
  }

  // softmax 归一化
  private softmax(logits: number[]): number[] {
    const maxLogit = Math.max(...logits) // 获取最大 logit
    const scores = logits.map((l) => Math.exp(l - maxLogit)) // 计算分数
    const sum = scores.reduce((a, b) => a + b, 0) // 计算分数和
    return scores.map((s) => s / sum) // 归一化
  }

  // 格式化结果
  private formatResults(samples: string[], probabilities: number[]): string {
    return Array.from(new Set(samples)) // 去重样本
      .map((s, i) => `${i + 1}. ${s}: ${probabilities[i].toFixed(3)}`.trim()) // 格式化输出
      .join("\n") // 连接为字符串
  }

  // 加载模型
  private async loadModel(): Promise<void> {
    try {
      logger.log("Loading reranker model...") // 加载模型日志
      this._session = await ort.InferenceSession.create(this._modelPath, {
        executionProviders: ["wasm"], // 使用 WASM 执行
      })
      logger.log("Reranker model loaded") // 模型加载成功日志
    } catch (error) {
      console.error(error) // 处理错误
      throw error
    }
  }

  // 加载分词器
  private async loadTokenizer(): Promise<void> {
    try {
      logger.log("Loading tokenizer...") // 加载分词器日志
      this._tokenizer = new Toxe(this._tokenizerPath) // 初始化分词器
      logger.log("Tokenizer loaded") // 分词器加载成功日志
    } catch (error) {
      console.error(error) // 处理错误
      throw error
    }
  }
}

