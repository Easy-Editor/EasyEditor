/**
 * Local Material Loader
 * 本地物料开发加载器（支持 WebSocket HMR）
 */

import { type Component, type ComponentMetadata, materials } from '@easy-editor/core'

/** 连接状态 */
interface ConnectionState {
  url: string
  componentName: string
  ws?: WebSocket
}

/** 连接配置 */
export interface LocalLoaderConfig {
  devServerUrl: string
}

/** 事件类型 */
type EventType = 'connected' | 'disconnected' | 'error' | 'hmr:update'

/** 事件监听器 */
type EventListener<T = unknown> = (data: T) => void

/**
 * 本地物料加载器
 * 用于连接本地开发服务器，支持 HMR 热更新
 */
export class LocalLoader {
  /** 活动连接 */
  private connections = new Map<string, ConnectionState>()

  /** 事件监听器 */
  private listeners = new Map<EventType, Set<EventListener>>()

  /**
   * 连接到本地开发服务器
   */
  async connect(config: LocalLoaderConfig): Promise<void> {
    const { devServerUrl } = config

    // 检查是否已连接
    if (this.connections.has(devServerUrl)) {
      console.log(`[LocalLoader] Already connected to: ${devServerUrl}`)
      return
    }

    try {
      // 1. 获取物料信息
      const infoUrl = `${devServerUrl}/material-info`
      const response = await fetch(infoUrl)

      if (!response.ok) {
        throw new Error(`Failed to fetch material info: HTTP ${response.status}`)
      }

      const materialInfo = await response.json()
      const { componentName, globalName } = materialInfo

      // 2. 加载物料脚本
      await this.loadScript(`${devServerUrl}/dist/index.js`)

      // 3. 从全局变量获取物料
      const global = window as unknown as Record<string, unknown>
      const materialExports = global[globalName] as Record<string, unknown> | undefined

      if (!materialExports) {
        throw new Error(`UMD export not found: window.${globalName}`)
      }

      const defaultExport = materialExports.default as Record<string, unknown> | undefined
      const meta = (materialExports.meta || defaultExport?.meta) as ComponentMetadata | undefined
      const _component = (materialExports.component || defaultExport?.component) as Component | undefined

      if (!meta?.componentName) {
        throw new Error('Invalid metadata: missing componentName')
      }

      // 4. 注册到物料系统
      materials.buildComponentMetasMap([meta])

      // 5. 建立 WebSocket 连接（用于 HMR）
      const wsUrl = devServerUrl.replace(/^http/, 'ws') + '/ws'
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        console.log(`[LocalLoader] WebSocket connected: ${wsUrl}`)
      }

      ws.onmessage = event => {
        try {
          const message = JSON.parse(event.data)
          if (message.type === 'hmr:update') {
            this.handleHmrUpdate(devServerUrl, message)
          }
        } catch (error) {
          console.error('[LocalLoader] Failed to parse WebSocket message:', error)
        }
      }

      ws.onerror = error => {
        console.error('[LocalLoader] WebSocket error:', error)
        this.emit('error', { error: new Error('WebSocket connection error') })
      }

      ws.onclose = () => {
        console.log(`[LocalLoader] WebSocket disconnected: ${wsUrl}`)
        this.connections.delete(devServerUrl)
        this.emit('disconnected', { url: devServerUrl })
      }

      // 6. 保存连接状态
      this.connections.set(devServerUrl, {
        url: devServerUrl,
        componentName,
        ws,
      })

      console.log(`[LocalLoader] Connected to: ${devServerUrl} (${componentName})`)
      this.emit('connected', { url: devServerUrl, componentName })
    } catch (error) {
      console.error(`[LocalLoader] Failed to connect to: ${devServerUrl}`, error)
      this.emit('error', { error: error instanceof Error ? error : new Error(String(error)) })
      throw error
    }
  }

  /**
   * 断开连接
   */
  disconnect(url: string): void {
    const connection = this.connections.get(url)
    if (connection) {
      connection.ws?.close()
      this.connections.delete(url)
      console.log(`[LocalLoader] Disconnected from: ${url}`)
      this.emit('disconnected', { url })
    }
  }

  /**
   * 断开所有连接
   */
  disconnectAll(): void {
    for (const url of this.connections.keys()) {
      this.disconnect(url)
    }
  }

  /**
   * 刷新物料
   */
  async refresh(url: string): Promise<void> {
    const connection = this.connections.get(url)
    if (!connection) {
      throw new Error(`Not connected to: ${url}`)
    }

    // 断开并重新连接
    this.disconnect(url)
    await this.connect({ devServerUrl: url })
  }

  /**
   * 检查是否已连接
   */
  isConnected(url: string): boolean {
    return this.connections.has(url)
  }

  /**
   * 获取所有连接
   */
  getConnections(): ConnectionState[] {
    return Array.from(this.connections.values()).map(({ url, componentName }) => ({
      url,
      componentName,
    }))
  }

  /**
   * 添加事件监听器
   */
  on<T = unknown>(event: EventType, listener: EventListener<T>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(listener as EventListener)
  }

  /**
   * 移除事件监听器
   */
  off<T = unknown>(event: EventType, listener: EventListener<T>): void {
    this.listeners.get(event)?.delete(listener as EventListener)
  }

  /**
   * 触发事件
   */
  private emit<T = unknown>(event: EventType, data: T): void {
    this.listeners.get(event)?.forEach(listener => {
      try {
        listener(data)
      } catch (error) {
        console.error(`[LocalLoader] Event listener error:`, error)
      }
    })
  }

  /**
   * 处理 HMR 更新
   */
  private async handleHmrUpdate(url: string, message: { componentName: string }): Promise<void> {
    console.log(`[LocalLoader] HMR update received for: ${message.componentName}`)

    try {
      // 重新加载物料
      await this.refresh(url)
      this.emit('hmr:update', { url, componentName: message.componentName })
    } catch (error) {
      console.error('[LocalLoader] HMR update failed:', error)
      this.emit('error', { error: error instanceof Error ? error : new Error(String(error)) })
    }
  }

  /**
   * 加载脚本
   */
  private loadScript(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // 移除旧脚本（如果存在）
      const existingScript = document.querySelector(`script[data-local-loader-url="${url}"]`)
      if (existingScript) {
        existingScript.remove()
      }

      const script = document.createElement('script')
      script.src = `${url}?t=${Date.now()}` // 添加时间戳防止缓存
      script.setAttribute('data-local-loader-url', url)
      script.async = true

      script.onload = () => {
        console.log(`[LocalLoader] Script loaded: ${url}`)
        resolve()
      }

      script.onerror = () => {
        reject(new Error(`Failed to load script: ${url}`))
      }

      document.head.appendChild(script)
    })
  }
}

/** 导出单例 */
export const localLoader = new LocalLoader()
