/**
 * Local Material Loader
 * 本地物料加载器 - 用于开发模式下的本地物料调试
 *
 * 支持：
 * - 连接 Vite 开发服务器
 * - 加载完整物料模块（component、meta、configure、snippets）
 * - 注册到 materials 系统
 * - Vite HMR 热更新
 */

import { materials, MaterialSource } from '@easy-editor/core'
import type { ComponentMetadata } from '@easy-editor/core'
import { runInAction } from 'mobx'

/**
 * 简单的事件发射器
 */
class EventEmitter {
  private events: Map<string, Set<(...args: unknown[]) => void>> = new Map()

  on(event: string, handler: (...args: unknown[]) => void) {
    if (!this.events.has(event)) {
      this.events.set(event, new Set())
    }
    this.events.get(event)!.add(handler)
    return () => this.off(event, handler)
  }

  off(event: string, handler: (...args: unknown[]) => void) {
    const handlers = this.events.get(event)
    if (handlers) {
      handlers.delete(handler)
    }
  }

  emit(event: string, ...args: unknown[]) {
    const handlers = this.events.get(event)
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(...args)
        } catch (error) {
          console.error(`[LocalMaterialLoader] Event handler error (${event}):`, error)
        }
      })
    }
  }
}

/** 物料连接配置 */
export interface LocalMaterialConfig {
  /** 开发服务器地址 */
  devServerUrl: string
}

/** 物料服务器返回的信息 */
export interface MaterialServerInfo {
  name: string
  title?: string
  version: string
  group?: string
  category?: string
  entry: string
  hasComponent: boolean
  hasMeta: boolean
  hasConfigure: boolean
  hasSnippets: boolean
  hmrPort?: number
  /** WebSocket 路径 */
  wsPath?: string
}

/** 加载的物料模块 */
export interface LoadedMaterialModule {
  /** 默认导出（通常是组件） */
  default?: React.ComponentType<unknown>
  /** 组件 */
  component?: React.ComponentType<unknown>
  /** 元数据 */
  meta?: ComponentMetadata
}

/** 物料连接信息 */
interface MaterialConnection {
  url: string
  componentName: string
  module: LoadedMaterialModule
  ws?: WebSocket
  info: MaterialServerInfo
  /** 重连状态 */
  reconnect: {
    /** 重试次数 */
    retries: number
    /** 重连定时器 */
    timer?: ReturnType<typeof setTimeout>
    /** 是否正在重连 */
    isReconnecting: boolean
  }
}

/** 调试物料分组名称 */
const DEBUG_GROUP = 'DEBUG'

/** WebSocket 重连配置 */
const WS_RECONNECT_CONFIG = {
  /** 最大重试次数 */
  maxRetries: 5,
  /** 初始重连延迟（毫秒） */
  initialDelay: 1000,
  /** 最大重连延迟（毫秒） */
  maxDelay: 30000,
  /** 延迟增长因子 */
  backoffFactor: 2,
}

/**
 * 本地物料加载器
 * 用于连接本地开发服务器并加载物料到编辑器
 */
class LocalMaterialLoaderClass extends EventEmitter {
  /** 活动连接 */
  private connections = new Map<string, MaterialConnection>()

  /** 模块缓存版本（用于强制刷新） */
  private moduleVersion = new Map<string, number>()

  /**
   * 连接本地物料开发服务器
   */
  async connect(config: LocalMaterialConfig): Promise<LoadedMaterialModule> {
    const { devServerUrl } = config
    const normalizedUrl = this.normalizeUrl(devServerUrl)

    // 检查是否已连接
    if (this.connections.has(normalizedUrl)) {
      console.warn(`[LocalMaterialLoader] Already connected to ${normalizedUrl}`)
      return this.connections.get(normalizedUrl)!.module
    }

    try {
      // 1. 健康检查
      await this.checkHealth(normalizedUrl)
      this.emit('status', { url: normalizedUrl, status: 'checking' })

      // 2. 获取物料信息
      const info = await this.fetchMaterialInfo(normalizedUrl)
      this.emit('status', { url: normalizedUrl, status: 'loading', info })

      // 3. 动态导入物料模块
      const module = await this.loadModule(normalizedUrl, info.entry)

      if (!module.meta) {
        throw new Error('Material meta not found in module')
      }

      // 4. 注册到 materials 系统
      this.registerMaterial(normalizedUrl, module)

      // 5. 建立 HMR 连接（使用 Vite 的 HMR 协议）
      const ws = this.setupViteHMR(normalizedUrl, info)

      // 6. 缓存连接信息
      const connection: MaterialConnection = {
        url: normalizedUrl,
        componentName: module.meta.componentName,
        module,
        ws,
        info,
        reconnect: {
          retries: 0,
          isReconnecting: false,
        },
      }
      this.connections.set(normalizedUrl, connection)

      this.emit('connected', {
        url: normalizedUrl,
        componentName: module.meta.componentName,
        meta: module.meta,
      })

      console.log(`[LocalMaterialLoader] Connected to ${normalizedUrl}`, module.meta.componentName)
      return module
    } catch (error) {
      this.emit('error', { url: normalizedUrl, error })
      throw error
    }
  }

  /**
   * 断开连接
   */
  disconnect(devServerUrl: string) {
    const normalizedUrl = this.normalizeUrl(devServerUrl)
    const connection = this.connections.get(normalizedUrl)

    if (!connection) {
      console.warn(`[LocalMaterialLoader] Not connected to ${normalizedUrl}`)
      return
    }

    // 清除重连定时器
    if (connection.reconnect.timer) {
      clearTimeout(connection.reconnect.timer)
    }

    // 关闭 WebSocket
    if (connection.ws) {
      connection.ws.close()
    }

    // 从 materials 系统移除（使用 runInAction 确保 MobX 响应式）
    runInAction(() => {
      try {
        materials.removeComponentMeta(connection.componentName)
      } catch (error) {
        console.warn('[LocalMaterialLoader] Failed to remove material from registry:', error)
      }
    })

    // 清理缓存
    this.connections.delete(normalizedUrl)
    this.moduleVersion.delete(normalizedUrl)

    this.emit('disconnected', {
      url: normalizedUrl,
      componentName: connection.componentName,
    })

    console.log(`[LocalMaterialLoader] Disconnected from ${normalizedUrl}`)
  }

  /**
   * 断开所有连接
   */
  disconnectAll() {
    const urls = Array.from(this.connections.keys())
    for (const url of urls) {
      this.disconnect(url)
    }
  }

  /**
   * 获取所有活动连接
   */
  getConnections(): Array<{ url: string; componentName: string }> {
    return Array.from(this.connections.entries()).map(([url, conn]) => ({
      url,
      componentName: conn.componentName,
    }))
  }

  /**
   * 检查是否已连接
   */
  isConnected(devServerUrl: string): boolean {
    return this.connections.has(this.normalizeUrl(devServerUrl))
  }

  /**
   * 健康检查
   */
  private async checkHealth(url: string): Promise<void> {
    try {
      const response = await fetch(`${url}/api/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        throw new Error(`Server responded with status ${response.status}`)
      }

      const data = await response.json()
      if (data.status !== 'ok') {
        throw new Error('Server health check failed')
      }
    } catch (error) {
      throw new Error(
        `Cannot connect to dev server at ${url}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * 获取物料信息
   */
  private async fetchMaterialInfo(url: string): Promise<MaterialServerInfo> {
    try {
      const response = await fetch(`${url}/api/material`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Server responded with status ${response.status}`)
      }

      return await response.json()
    } catch (error) {
      throw new Error(`Failed to fetch material info: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 动态加载物料模块
   */
  private async loadModule(baseUrl: string, entry: string): Promise<LoadedMaterialModule> {
    // 增加版本号以强制刷新
    const version = (this.moduleVersion.get(baseUrl) || 0) + 1
    this.moduleVersion.set(baseUrl, version)

    const moduleUrl = `${baseUrl}${entry}?t=${Date.now()}&v=${version}`

    try {
      const module = await import(/* @vite-ignore */ moduleUrl)
      return module
    } catch (error) {
      throw new Error(`Failed to load material module: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 注册物料到 materials 系统
   */
  private registerMaterial(url: string, module: LoadedMaterialModule) {
    const meta = module.meta
    if (!meta) {
      throw new Error('Material meta is required')
    }

    // 获取组件
    const component = module.component || module.default

    // 创建干净的元数据副本（不添加私有字段）
    const registrationMeta: ComponentMetadata = {
      ...meta,
      // 强制设置为调试分组
      group: DEBUG_GROUP,
      // 深拷贝 configure，设置 view 为加载的组件
      configure: meta.configure
        ? {
            ...meta.configure,
            advanced: {
              ...meta.configure.advanced,
              view: component,
            },
          }
        : {
            advanced: {
              view: component,
            },
          },
    }

    // 使用 runInAction 确保 MobX 响应式正确触发
    runInAction(() => {
      // 使用新的 registry API 注册，标记为本地调试物料
      materials.createComponentMeta(registrationMeta, {
        source: MaterialSource.LOCAL_DEBUG,
        component,
      })

      // 在 registry 的 extensions 中存储调试信息（不污染元数据）
      const entry = materials.registry.get(meta.componentName)
      if (entry) {
        entry.extensions = entry.extensions || new Map()
        entry.extensions.set('devServerUrl', url)
        entry.extensions.set('isLocalDebug', true)
      }

      // 强制刷新 componentMetasMap
      materials.refreshComponentMetasMap()
    })

    console.log(`[LocalMaterialLoader] Registered material: ${meta.componentName}`)
  }

  /**
   * 设置 Vite HMR 监听
   * 连接到物料开发服务器的 WebSocket
   */
  private setupViteHMR(url: string, info: MaterialServerInfo): WebSocket | undefined {
    try {
      // 使用物料服务器提供的 WebSocket 路径
      const wsPath = info.wsPath || '/ws'
      const wsProtocol = url.startsWith('https') ? 'wss' : 'ws'
      const wsUrl = `${url.replace(/^https?/, wsProtocol)}${wsPath}`

      console.log(`[LocalMaterialLoader] Connecting to WebSocket: ${wsUrl}`)

      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        console.log(`[LocalMaterialLoader] HMR WebSocket connected to ${wsUrl}`)
        this.emit('ws:connected', { url })

        // 重置重连状态
        const connection = this.connections.get(url)
        if (connection) {
          connection.reconnect.retries = 0
          connection.reconnect.isReconnecting = false
        }
      }

      ws.onmessage = async event => {
        try {
          const data = JSON.parse(event.data)
          console.log('[LocalMaterialLoader] WebSocket message:', data.type)

          // 处理不同类型的消息
          if (data.type === 'connected') {
            console.log('[LocalMaterialLoader] Server acknowledged connection')
          } else if (data.type === 'update') {
            console.log('[LocalMaterialLoader] HMR update detected, reloading module...')
            await this.handleHMRUpdate(url, info)
          }
        } catch {
          // 忽略非 JSON 消息
        }
      }

      ws.onerror = error => {
        // WebSocket 连接失败不影响主流程，只影响热更新
        console.warn('[LocalMaterialLoader] HMR WebSocket connection failed:', error)
        this.emit('ws:error', { url, error })
      }

      ws.onclose = () => {
        console.log('[LocalMaterialLoader] HMR WebSocket closed')
        this.emit('ws:closed', { url })

        // 尝试自动重连
        this.scheduleReconnect(url, info)
      }

      return ws
    } catch (error) {
      console.warn('[LocalMaterialLoader] Failed to setup HMR:', error)
      return undefined
    }
  }

  /**
   * 计划 WebSocket 重连
   */
  private scheduleReconnect(url: string, info: MaterialServerInfo): void {
    const connection = this.connections.get(url)
    if (!connection) {
      return // 连接已断开，不需要重连
    }

    // 检查是否超过最大重试次数
    if (connection.reconnect.retries >= WS_RECONNECT_CONFIG.maxRetries) {
      console.warn(
        `[LocalMaterialLoader] Max reconnection attempts (${WS_RECONNECT_CONFIG.maxRetries}) reached for ${url}`,
      )
      this.emit('ws:reconnect:failed', { url, retries: connection.reconnect.retries })
      return
    }

    // 计算重连延迟（指数退避）
    const delay = Math.min(
      WS_RECONNECT_CONFIG.initialDelay * Math.pow(WS_RECONNECT_CONFIG.backoffFactor, connection.reconnect.retries),
      WS_RECONNECT_CONFIG.maxDelay,
    )

    connection.reconnect.retries++
    connection.reconnect.isReconnecting = true

    console.log(
      `[LocalMaterialLoader] Scheduling reconnection attempt ${connection.reconnect.retries}/${WS_RECONNECT_CONFIG.maxRetries} in ${delay}ms`,
    )

    this.emit('ws:reconnecting', { url, attempt: connection.reconnect.retries, delay })

    // 清除之前的定时器
    if (connection.reconnect.timer) {
      clearTimeout(connection.reconnect.timer)
    }

    // 设置重连定时器
    connection.reconnect.timer = setTimeout(() => {
      // 再次检查连接是否还存在
      if (!this.connections.has(url)) {
        return
      }

      console.log(`[LocalMaterialLoader] Attempting reconnection ${connection.reconnect.retries}`)

      // 创建新的 WebSocket
      const newWs = this.setupViteHMR(url, info)
      if (newWs) {
        connection.ws = newWs
      }
    }, delay)
  }

  /**
   * 处理 HMR 更新
   */
  private async handleHMRUpdate(url: string, info: MaterialServerInfo) {
    try {
      // 重新加载模块
      const module = await this.loadModule(url, info.entry)

      if (module.meta) {
        // 重新注册
        this.registerMaterial(url, module)

        // 更新连接信息
        const connection = this.connections.get(url)
        if (connection) {
          connection.module = module
        }

        this.emit('hmr:update', {
          url,
          componentName: module.meta.componentName,
          module,
        })

        console.log('[LocalMaterialLoader] HMR update completed')
      }
    } catch (error) {
      console.error('[LocalMaterialLoader] HMR update failed:', error)
      this.emit('hmr:error', { url, error })
    }
  }

  /**
   * 手动刷新物料（当 HMR 不工作时使用）
   */
  async refresh(devServerUrl: string): Promise<void> {
    const normalizedUrl = this.normalizeUrl(devServerUrl)
    const connection = this.connections.get(normalizedUrl)

    if (!connection) {
      throw new Error(`Not connected to ${normalizedUrl}`)
    }

    await this.handleHMRUpdate(normalizedUrl, connection.info)
  }

  /**
   * 规范化 URL
   */
  private normalizeUrl(url: string): string {
    // 移除末尾斜杠
    return url.replace(/\/+$/, '')
  }
}

// 导出单例
export const localLoader = new LocalMaterialLoaderClass()

// 也导出类，便于测试
export { LocalMaterialLoaderClass }
