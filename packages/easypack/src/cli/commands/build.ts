/**
 * Build Command
 * 生产构建命令
 */

import { spawn } from 'node:child_process'
import pc from 'picocolors'
import { rollup } from 'rollup'
import type { CliArgs } from '../index'
import { loadConfig } from '../../config'
import { createRollupConfig } from '../../rollup'
import type { ResolvedConfig } from '../../config/types'

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
  const config = await loadConfig(argv.config)

  console.log(pc.gray(`  Package: ${config.pkg.name}@${config.pkg.version}`))
  console.log(pc.gray(`  Preset:  ${config.preset}`))
  console.log(pc.gray(`  Output:  ${config.output.dir}/\n`))

  // 生成 Rollup 配置
  const rollupConfigs = createRollupConfig({ config })

  let fileCount = 0

  // 执行构建
  for (const rollupConfig of rollupConfigs) {
    const bundle = await rollup(rollupConfig)

    const outputs = Array.isArray(rollupConfig.output) ? rollupConfig.output : [rollupConfig.output]

    for (const output of outputs) {
      if (output && output.file) {
        await bundle.write(output)
        console.log(pc.green(`  ✓ ${output.file}`))
        fileCount++
      }
    }

    await bundle.close()
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
      console.log(pc.yellow(`  ⚠ Types generation skipped (no tsconfig.json or tsc error)`))
    }
  }

  const duration = Date.now() - startTime
  console.log('')
  console.log(pc.green(`Build completed! `) + pc.gray(`(${fileCount} files in ${duration}ms)`))
}
