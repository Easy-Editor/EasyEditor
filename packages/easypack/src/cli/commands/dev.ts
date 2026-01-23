/**
 * Dev Command
 * 开发服务器命令
 */

import pc from 'picocolors'
import { createServer } from 'vite'
import type { CliArgs } from '../index'
import { loadConfig } from '../../config'
import { createViteConfig } from '../../vite'

export async function devCommand(argv: CliArgs): Promise<void> {
  console.log(pc.cyan('Starting development server...\n'))

  // 加载配置
  const config = await loadConfig(argv.config)

  console.log(pc.gray(`  Package: ${config.pkg.name}@${config.pkg.version}`))
  console.log(pc.gray(`  Preset:  ${config.preset}`))
  console.log(pc.gray(`  Port:    ${config.dev.port}\n`))

  // 创建 Vite 配置
  const viteConfig = createViteConfig({ config })

  // 创建并启动开发服务器
  const server = await createServer(viteConfig)
  await server.listen()

  // Vite 会自动打印服务器地址
  server.printUrls()

  // 监听退出信号
  const shutdown = async () => {
    console.log(pc.yellow('\nShutting down...'))
    await server.close()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
