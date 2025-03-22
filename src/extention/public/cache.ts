import { PrefixSuffix } from "../../common/types"

// LRU缓存类，使用泛型 T 表示缓存值的类型，默认类型为 string
export class LRUCache<T = string> {
  private _capacity: number // 缓存的最大容量
  private _cache: Map<string, T | null> // 使用 Map 存储缓存数据

  // 构造函数，初始化缓存容量
  constructor(capacity: number) {
    this._capacity = capacity
    this._cache = new Map()
  }

  // 获取所有缓存数据
  getAll(): Map<string, T | null> {
    return this._cache
  }

  // 根据键获取缓存值，如果存在则更新其访问顺序
  get(key: string): T | null | undefined {
    if (!this._cache.has(key)) return undefined // 如果键不存在，返回 undefined

    const value = this._cache.get(key)
    this._cache.delete(key) // 删除旧键值对
    if (value !== undefined) {
      this._cache.set(key, value) // 重新插入，更新访问顺序
    }
    return value
  }

  // 根据键删除缓存值
  delete(key: string): void {
    this._cache.delete(key)
  }

  // 设置缓存值，如果缓存已满则删除最久未使用的键值对
  set(key: string, value: T | null): void {
    if (this._cache.has(key)) {
      this._cache.delete(key) // 如果键已存在，先删除
    } else if (this._cache.size === this._capacity) {
      const firstKey = this._cache.keys().next().value // 获取最久未使用的键
      if (!firstKey) return
      this._cache.delete(firstKey) // 删除最久未使用的键值对
    }
    this._cache.set(key, value) // 插入新键值对
  }

  // 规范化字符串，去除换行符和多余的空格
  normalize(src: string): string {
    return src.split("\n").join("").replace(/\s+/g, "").replace(/\s/g, "")
  }

  // 根据 PrefixSuffix 对象生成缓存键
  getKey(prefixSuffix: PrefixSuffix): string {
    const { prefix, suffix } = prefixSuffix
    if (suffix) {
      return this.normalize(prefix + " #### " + suffix) // 如果有后缀，拼接并规范化
    }
    return this.normalize(prefix) // 只有前缀，直接规范化
  }

  // 根据 PrefixSuffix 对象获取缓存值
  getCache(prefixSuffix: PrefixSuffix): T | undefined | null {
    const key = this.getKey(prefixSuffix) // 生成键
    return this.get(key) // 获取缓存值
  }

  // 根据 PrefixSuffix 对象设置缓存值
  setCache(prefixSuffix: PrefixSuffix, completion: T): void {
    const key = this.getKey(prefixSuffix) // 生成键
    this.set(key, completion) // 设置缓存值
  }
}

// 创建一个容量为 50 的 LRU 缓存实例
export const cache = new LRUCache(50)