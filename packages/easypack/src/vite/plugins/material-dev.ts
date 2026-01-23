/**
 * Vite Plugin: Material Development
 * 物料开发插件 - 提供物料调试所需的 API 和 WebSocket 通知
 */

import type { Plugin, ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'

export interface MaterialDevPluginOptions {
  /** 物料入口文件路径 */
  entry?: string
}

/**
 * 物料开发插件
 * 提供：
 * - /api/health - 健康检查
 * - /api/material - 物料信息
 * - WebSocket 通知 - 文件变更时通知连接的客户端
 */
export function materialDevPlugin(options: MaterialDevPluginOptions = {}): Plugin {
  const { entry = '/src/index.tsx' } = options

  let server: ViteDevServer
  let wss: WebSocketServer | null = null
  const clients = new Set<WebSocket>()

  // 广播消息给所有连接的客户端
  function broadcast(message: object) {
    const data = JSON.stringify(message)
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data)
      }
    }
  }

  return {
    name: 'vite-plugin-material-dev',

    configureServer(_server) {
      server = _server

      // 创建 WebSocket 服务器，复用 Vite 的 HTTP 服务器
      wss = new WebSocketServer({ noServer: true })

      // 处理 WebSocket 升级请求
      server.httpServer?.on('upgrade', (request, socket, head) => {
        // 只处理 /ws 路径的 WebSocket 请求，避免与 Vite HMR 冲突
        if (request.url === '/ws' || request.url === '/__material_ws__') {
          wss?.handleUpgrade(request, socket, head, ws => {
            wss?.emit('connection', ws, request)
          })
        }
      })

      wss.on('connection', ws => {
        clients.add(ws)

        // 发送连接成功消息
        ws.send(
          JSON.stringify({
            type: 'connected',
            message: 'Material dev server connected',
            timestamp: Date.now(),
          }),
        )

        ws.on('close', () => {
          clients.delete(ws)
        })

        ws.on('error', () => {
          clients.delete(ws)
        })
      })

      // 处理 CORS 预检请求
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
          res.statusCode = 204
          res.end()
          return
        }
        next()
      })

      // 健康检查 API
      server.middlewares.use('/api/health', (_req: IncomingMessage, res: ServerResponse) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.end(
          JSON.stringify({
            status: 'ok',
            timestamp: Date.now(),
            server: 'vite',
            wsPath: '/ws',
          }),
        )
      })

      // 物料信息 API
      server.middlewares.use('/api/material', async (_req: IncomingMessage, res: ServerResponse) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Access-Control-Allow-Origin', '*')

        try {
          // 使用 Vite 的 SSR 模块加载能力加载物料模块
          const module = await server.ssrLoadModule(entry)

          const meta = module.meta || module.default?.meta
          const component = module.component || module.default

          if (!meta) {
            res.statusCode = 400
            res.end(
              JSON.stringify({
                error: 'Material meta not found. Make sure to export "meta" from the entry file.',
              }),
            )
            return
          }

          // 返回物料信息
          const materialInfo = {
            name: meta.componentName,
            title: meta.title,
            version: meta.npm?.version || '0.0.0-dev',
            group: meta.group,
            category: meta.category,
            entry,
            hasComponent: !!component,
            hasMeta: !!meta,
            hasConfigure: !!meta.configure,
            hasSnippets: Array.isArray(meta.snippets) && meta.snippets.length > 0,
            wsPath: '/ws',
          }

          res.end(JSON.stringify(materialInfo))
        } catch (error) {
          res.statusCode = 500
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          )
        }
      })

      // 在服务器启动时打印信息
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address()
        const port = typeof address === 'object' && address ? address.port : 5001
        const host = server.config.server.host || 'localhost'

        setTimeout(() => {
          console.log('')
          console.log('\x1b[36m%s\x1b[0m', '  Material Dev Server Ready')
          console.log('')
          console.log(`  Health Check:  http://${host}:${port}/api/health`)
          console.log(`  Material Info: http://${host}:${port}/api/material`)
          console.log(`  Module Entry:  http://${host}:${port}${entry}`)
          console.log(`  WebSocket:     ws://${host}:${port}/ws`)
          console.log('')
          console.log('\x1b[33m%s\x1b[0m', '  Connect this URL in EasyEditor to start debugging')
          console.log('')
        }, 100)
      })
    },

    // 监听 Vite 的 HMR 事件，转发给我们的 WebSocket 客户端
    handleHotUpdate({ file, modules }) {
      // 通知所有连接的客户端
      broadcast({
        type: 'update',
        file,
        timestamp: Date.now(),
        modules: modules.map(m => m.id),
      })

      // 返回 undefined 让 Vite 继续处理 HMR
      return
    },

    // 插件关闭时清理
    closeBundle() {
      if (wss) {
        for (const client of clients) {
          client.close()
        }
        clients.clear()
        wss.close()
        wss = null
      }
    },
  }
}
