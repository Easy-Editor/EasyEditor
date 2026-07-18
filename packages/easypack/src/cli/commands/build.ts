/**
 * Build Command
 * 生产构建命令
 */

import { spawn } from 'node:child_process'
import pc from 'picocolors'
import { buildEasypack, loadEasypackWorkspaceConfig } from '../../build'
import type { ResolvedConfig } from '../../config/types'
import type { CliArgs } from '../index'

/**
 * 生成 TypeScript 类型声明
 */
async function generateTypes(config: ResolvedConfig): Promise<string[]> {
  return new Promise((resolve, reject) => {
    // 使用 execSync 更简洁，避免 shell: true 的安全警告
    const args = ['tsc', '--declaration', '--emitDeclarationOnly', '--outDir', config.output.dir]
    const tsc = spawn('npx', args, {
      stdio: 'pipe',
    })

    let stderr = ''
    tsc.stderr?.on('data', data => {
      stderr += data.toString()
    })

    tsc.on('close', code => {
      if (code === 0) {
        resolve([`${config.output.dir}/index.d.ts`])
      } else {
        reject(new Error(`TypeScript compilation failed:\n${stderr}`))
      }
    })

    tsc.on('error', reject)
  })
}

export async function buildCommand(argv: CliArgs): Promise<void> {
  const startTime = Date.now()
  console.log(pc.cyan('Building for production...\n'))

  // 加载配置
  const rootDir = process.cwd()
  const config = await loadEasypackWorkspaceConfig({ rootDir, configFile: argv.config })

  console.log(pc.gray(`  Package: ${config.pkg.name}@${config.pkg.version}`))
  console.log(pc.gray(`  Preset:  ${config.preset}`))
  console.log(pc.gray(`  Output:  ${config.output.dir}/\n`))

  const result = await buildEasypack({ rootDir, config })
  let fileCount = result.artifacts.length
  for (const artifact of result.artifacts) {
    console.log(pc.green(`  ✓ ${artifact.path}`))
  }

  // 生成类型声明
  if (config.output.types) {
    try {
      const typeFiles = await generateTypes(config)
      for (const file of typeFiles) {
        console.log(pc.green(`  ✓ ${file}`))
        fileCount++
      }
    } catch (error) {
      console.log(pc.yellow('  ⚠ Types generation skipped (no tsconfig.json or tsc error)'))
    }
  }

  const duration = Date.now() - startTime
  console.log('')
  console.log(pc.green('Build completed! ') + pc.gray(`(${fileCount} files in ${duration}ms)`))
}
