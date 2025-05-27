import * as prompts from '@clack/prompts'
import mri from 'mri'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FRAMEWORKS, SCENARIOS, defaultTargetDir, helpMessage, renameFiles } from './const'
import {
  copy,
  emptyDir,
  formatTargetDir,
  isEmpty,
  isValidPackageName,
  pkgFromUserAgent,
  toValidPackageName,
} from './utils'

const argv = mri<{
  scenarios?: string
  template?: string
  help?: boolean
  overwrite?: boolean
}>(process.argv.slice(2), {
  alias: { h: 'help', t: 'template', s: 'scenarios' },
  boolean: ['help', 'overwrite'],
  string: ['template', 'scenarios'],
})
const cwd = process.cwd()

const init = async () => {
  const argTargetDir = argv._[0] ? formatTargetDir(String(argv._[0])) : undefined
  const argTemplate = argv.template
  const argScenarios = argv.scenarios
  const argOverwrite = argv.overwrite

  const help = argv.help
  if (help) {
    console.log(helpMessage)
    return
  }

  const pkgInfo = pkgFromUserAgent(process.env.npm_config_user_agent)
  const cancel = () => prompts.cancel('Operation cancelled')

  // 1. Get project name and target dir
  let targetDir = argTargetDir
  if (!targetDir) {
    const projectName = await prompts.text({
      message: 'Project name:',
      defaultValue: defaultTargetDir,
      placeholder: defaultTargetDir,
    })
    if (prompts.isCancel(projectName)) return cancel()
    targetDir = formatTargetDir(projectName as string)
  }

  // 2. Handle directory if exist and not empty
  if (fs.existsSync(targetDir) && !isEmpty(targetDir)) {
    const overwrite = argOverwrite
      ? 'yes'
      : await prompts.select({
          message: `${targetDir === '.' ? 'Current directory' : `Target directory "${targetDir}"`} is not empty. Please choose how to proceed:`,
          options: [
            {
              label: 'Cancel operation',
              value: 'no',
            },
            {
              label: 'Remove existing files and continue',
              value: 'yes',
            },
            {
              label: 'Ignore files and continue',
              value: 'ignore',
            },
          ],
        })
    if (prompts.isCancel(overwrite)) return cancel()
    switch (overwrite) {
      case 'yes':
        emptyDir(targetDir)
        break
      case 'no':
        cancel()
        return
    }
  }

  // 3. Get package name
  let packageName = path.basename(path.resolve(targetDir))
  if (!isValidPackageName(packageName)) {
    const packageNameResult = await prompts.text({
      message: 'Package name:',
      defaultValue: toValidPackageName(packageName),
      placeholder: toValidPackageName(packageName),
      validate(dir) {
        if (!isValidPackageName(dir)) {
          return 'Invalid package.json name'
        }
      },
    })
    if (prompts.isCancel(packageNameResult)) return cancel()
    packageName = packageNameResult
  }

  // 4. Choose a application scenario
  let scenarios = argScenarios
  let hasInvalidArgScenarios = false
  if (argScenarios && !SCENARIOS.findIndex(scenario => scenario.name === argScenarios)) {
    scenarios = undefined
    hasInvalidArgScenarios = true
  }
  if (!scenarios) {
    const _scenarios = await prompts.select({
      message: hasInvalidArgScenarios
        ? `"${argScenarios}" isn't a valid scenario. Please choose from below: `
        : 'Select a scenario:',
      options: SCENARIOS.map(scenario => {
        const scenarioColor = scenario.color
        return {
          label: scenarioColor(scenario.display || scenario.name),
          value: scenario.name,
        }
      }),
    })
    if (prompts.isCancel(_scenarios)) return cancel()

    scenarios = _scenarios
  }

  // 5. Choose a framework and variant
  let framework = argTemplate
  let hasInvalidArgTemplate = false
  if (argTemplate && !FRAMEWORKS.findIndex(framework => framework.name === argTemplate)) {
    framework = undefined
    hasInvalidArgTemplate = true
  }
  if (!framework) {
    const _framework = await prompts.select({
      message: hasInvalidArgTemplate
        ? `"${argTemplate}" isn't a valid template. Please choose from below: `
        : 'Select a framework:',
      options: FRAMEWORKS.map(framework => {
        const frameworkColor = framework.color
        return {
          label: frameworkColor(framework.display || framework.name),
          value: framework.name,
        }
      }),
    })
    if (prompts.isCancel(_framework)) return cancel()

    framework = _framework
  }

  const root = path.join(cwd, targetDir)
  fs.mkdirSync(root, { recursive: true })

  // 6. determine template
  const pkgManager = pkgInfo ? pkgInfo.name : 'pnpm'

  prompts.log.step(`Scaffolding project in ${root}...`)

  const templateDir = path.resolve(fileURLToPath(import.meta.url), '../..', `template/${scenarios}/${framework}`)

  const write = (file: string, content?: string) => {
    const targetPath = path.join(root, renameFiles[file] ?? file)
    if (content) {
      fs.writeFileSync(targetPath, content)
    } else {
      copy(path.join(templateDir, file), targetPath)
    }
  }

  let files: string[]
  try {
    files = fs.readdirSync(templateDir)
  } catch (error) {
    prompts.log.warn(`Template for "${scenarios}/${framework}" is not yet supported.`)
    prompts.log.info(`We're working on adding more templates. Please check back later or contribute to our repository!`)
    return
  }

  for (const file of files.filter(f => f !== 'package.json')) {
    write(file)
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(templateDir, 'package.json'), 'utf-8'))

  pkg.name = packageName

  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`)

  let doneMessage = ''
  const cdProjectName = path.relative(cwd, root)
  doneMessage += 'Done. Now run:\n'
  if (root !== cwd) {
    doneMessage += `\n  cd ${cdProjectName.includes(' ') ? `"${cdProjectName}"` : cdProjectName}`
  }
  switch (pkgManager) {
    case 'pnpm':
      doneMessage += '\n  pnpm i'
      doneMessage += '\n  pnpm dev'
      break
    case 'yarn':
      doneMessage += '\n  yarn'
      doneMessage += '\n  yarn dev'
      break
    default:
      doneMessage += `\n  ${pkgManager} install`
      doneMessage += `\n  ${pkgManager} run dev`
      break
  }
  prompts.outro(doneMessage)
}

init().catch(e => {
  console.error(e)
})
