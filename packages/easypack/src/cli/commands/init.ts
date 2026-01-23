/**
 * Init Command
 * 初始化配置文件命令
 */

import * as prompts from '@clack/prompts'
import pc from 'picocolors'
import fs from 'node:fs'
import path from 'node:path'
import type { CliArgs } from '../index'

const MATERIAL_TEMPLATE = `/**
 * @easy-editor/easypack configuration
 * @type {import('@easy-editor/easypack').EasypackConfig}
 */
export default {
  preset: 'material',
  // globalName 自动从 package.json 推导
  dev: {
    port: 5001,
  },
  // output: {
  //   umd: true,       // UMD 格式（默认开启）
  //   esm: false,      // ESM 格式
  //   cjs: false,      // CJS 格式
  //   minify: true,    // 压缩输出（默认开启）
  //   types: false,    // TypeScript 类型声明
  // },
}
`

const SETTER_TEMPLATE = `/**
 * @easy-editor/easypack configuration
 * @type {import('@easy-editor/easypack').EasypackConfig}
 */
export default {
  preset: 'setter',
  globalName: 'EasyEditorSetters',
  // output: {
  //   umd: true,       // UMD 格式（默认开启）
  //   esm: false,      // ESM 格式
  //   cjs: false,      // CJS 格式
  //   minify: true,    // 压缩输出（默认开启）
  //   types: false,    // TypeScript 类型声明
  // },
}
`

const LIBRARY_TEMPLATE = `/**
 * @easy-editor/easypack configuration
 * @type {import('@easy-editor/easypack').EasypackConfig}
 */
export default {
  preset: 'library',
  // globalName: 'MyLibrary',
  // output: {
  //   umd: true,       // UMD 格式（默认开启）
  //   esm: false,      // ESM 格式
  //   cjs: false,      // CJS 格式
  //   minify: true,    // 压缩输出（默认开启）
  //   types: false,    // TypeScript 类型声明
  // },
}
`

export async function initCommand(argv: CliArgs): Promise<void> {
  const cwd = process.cwd()
  const configPath = path.join(cwd, 'easypack.config.ts')

  // 检查是否已存在配置文件
  if (fs.existsSync(configPath)) {
    const overwrite = await prompts.confirm({
      message: 'easypack.config.ts already exists. Overwrite?',
    })

    if (prompts.isCancel(overwrite) || !overwrite) {
      prompts.cancel('Operation cancelled')
      return
    }
  }

  // 选择预设
  let preset = argv.preset
  if (!preset) {
    const selected = await prompts.select({
      message: 'Select a preset:',
      options: [
        {
          label: 'material',
          value: 'material',
          hint: 'For EasyMaterials components',
        },
        {
          label: 'setter',
          value: 'setter',
          hint: 'For EasySetters package',
        },
        {
          label: 'library',
          value: 'library',
          hint: 'For general React libraries',
        },
      ],
    })

    if (prompts.isCancel(selected)) {
      prompts.cancel('Operation cancelled')
      return
    }

    preset = selected as string
  }

  // 根据预设选择模板
  let template: string
  switch (preset) {
    case 'material':
      template = MATERIAL_TEMPLATE
      break
    case 'setter':
      template = SETTER_TEMPLATE
      break
    case 'library':
    default:
      template = LIBRARY_TEMPLATE
      break
  }

  // 写入配置文件
  fs.writeFileSync(configPath, template)

  console.log('')
  console.log(pc.green('✓ Created easypack.config.ts'))
  console.log('')
  console.log(pc.gray('Next steps:'))
  console.log(pc.gray('  1. Review and customize the config file'))
  console.log(pc.gray('  2. Run `easypack build` to build for production'))
  console.log(pc.gray('  3. Run `easypack dev` to start dev server'))
  console.log('')
}
