/**
 * CLI Main Program
 * CLI 主程序
 */

import mri from 'mri'
import pc from 'picocolors'
import { buildCommand } from './commands/build'
import { devCommand } from './commands/dev'
import { initCommand } from './commands/init'

const VERSION = '0.0.1'

const helpMessage = `
${pc.bold(pc.cyan('@easy-editor/easypack'))} - Build and dev tools for EasyEditor ecosystem

${pc.bold('Usage:')}
  easypack <command> [options]

${pc.bold('Commands:')}
  build       Build for production
  dev         Start development server
  init        Generate config file template

${pc.bold('Options:')}
  -c, --config <file>   Config file path
  -h, --help            Show help
  -v, --version         Show version

${pc.bold('Examples:')}
  ${pc.gray('# Build for production')}
  easypack build

  ${pc.gray('# Start dev server')}
  easypack dev

  ${pc.gray('# Generate config template')}
  easypack init
`

export interface CliArgs {
  _: string[]
  help?: boolean
  version?: boolean
  config?: string
  preset?: string
}

export async function cli(): Promise<void> {
  const argv = mri<CliArgs>(process.argv.slice(2), {
    alias: {
      h: 'help',
      v: 'version',
      c: 'config',
      p: 'preset',
    },
    boolean: ['help', 'version'],
    string: ['config', 'preset'],
  })

  // 显示版本
  if (argv.version) {
    console.log(VERSION)
    return
  }

  // 显示帮助或无命令时
  if (argv.help || argv._.length === 0) {
    console.log(helpMessage)
    return
  }

  const command = argv._[0]

  try {
    switch (command) {
      case 'build':
        await buildCommand(argv)
        break
      case 'dev':
        await devCommand(argv)
        break
      case 'init':
        await initCommand(argv)
        break
      default:
        console.log(pc.red(`Unknown command: ${command}`))
        console.log(helpMessage)
        process.exit(1)
    }
  } catch (error) {
    console.error(pc.red('Error:'), error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
