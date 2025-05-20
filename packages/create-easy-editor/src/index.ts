import * as prompts from '@clack/prompts'
import mri from 'mri'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import colors from 'picocolors'

const { blue, cyan, gray } = colors

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

const helpMessage = `\
Usage:
  npm init @easy-editor [OPTION]... [DIRECTORY]
  npx @easy-editor/create [OPTION]... [DIRECTORY]

Create a new Easy Editor project in JavaScript or TypeScript.
With no arguments, start the CLI in interactive mode.

Options:
  -s, --scenarios NAME       use a specific scenario
  -t, --template NAME        use a specific template
  -h, --help                 display this help message
  --overwrite                overwrite target directory if it exists

Available templates:
${cyan('react-dashboard')}`

type ColorFunc = (str: string | number) => string
type Framework = {
  name: string
  display: string
  color: ColorFunc
  variants: FrameworkVariant[]
}
type FrameworkVariant = {
  name: string
  display: string
  color: ColorFunc
}

const FRAMEWORKS: Framework[] = [
  {
    name: 'react',
    display: 'React',
    color: cyan,
    variants: [
      {
        name: 'react',
        display: 'React',
        color: blue,
      },
    ],
  },
  {
    name: 'vue',
    display: 'Vue (Developing)',
    color: gray,
    variants: [
      {
        name: 'vue',
        display: 'Vue (Developing)',
        color: gray,
      },
    ],
  },
]

const TEMPLATES = FRAMEWORKS.map(f => f.variants.map(v => v.name)).reduce((a, b) => a.concat(b), [])

const SCENARIOS: FrameworkVariant[] = [
  {
    name: 'dashboard',
    display: 'Dashboard',
    color: blue,
  },
  {
    name: 'form',
    display: 'Form (Developing)',
    color: gray,
  },
]

const APPLICATIONS = SCENARIOS.map(s => s.name)

const renameFiles: Record<string, string | undefined> = {
  _gitignore: '.gitignore',
}

const defaultTargetDir = 'easy-editor'

async function init() {
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
  if (argScenarios && !APPLICATIONS.includes(argScenarios)) {
    scenarios = undefined
    hasInvalidArgScenarios = true
  }
  if (!scenarios) {
    const application = await prompts.select({
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
    if (prompts.isCancel(application)) return cancel()

    scenarios = application
  }

  // 5. Choose a framework and variant
  let template = argTemplate
  let hasInvalidArgTemplate = false
  if (argTemplate && !TEMPLATES.includes(argTemplate)) {
    template = undefined
    hasInvalidArgTemplate = true
  }
  if (!template) {
    const framework = await prompts.select({
      message: hasInvalidArgTemplate
        ? `"${argTemplate}" isn't a valid template. Please choose from below: `
        : 'Select a framework:',
      options: FRAMEWORKS.map(framework => {
        const frameworkColor = framework.color
        return {
          label: frameworkColor(framework.display || framework.name),
          value: framework,
        }
      }),
    })
    if (prompts.isCancel(framework)) return cancel()

    const variant = await prompts.select({
      message: 'Select a variant:',
      options: framework.variants.map(variant => {
        const variantColor = variant.color
        return {
          label: variantColor(variant.display || variant.name),
          value: variant.name,
        }
      }),
    })
    if (prompts.isCancel(variant)) return cancel()

    template = variant
  }

  const root = path.join(cwd, targetDir)
  fs.mkdirSync(root, { recursive: true })

  // 6. determine template
  const pkgManager = pkgInfo ? pkgInfo.name : 'npm'

  prompts.log.step(`Scaffolding project in ${root}...`)

  const templateDir = path.resolve(fileURLToPath(import.meta.url), '../..', `template/${scenarios}/${template}`)

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
    prompts.log.warn(`Template for "${scenarios}/${template}" is not yet supported.`)
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
    case 'yarn':
      doneMessage += '\n  yarn'
      doneMessage += '\n  yarn dev'
      break
    case 'pnpm':
      doneMessage += '\n  pnpm'
      doneMessage += '\n  pnpm dev'
      break
    default:
      doneMessage += `\n  ${pkgManager} install`
      doneMessage += `\n  ${pkgManager} run dev`
      break
  }
  prompts.outro(doneMessage)
}

function formatTargetDir(targetDir: string) {
  return targetDir.trim().replace(/\/+$/g, '')
}

function copy(src: string, dest: string) {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    copyDir(src, dest)
  } else {
    fs.copyFileSync(src, dest)
  }
}

function isValidPackageName(projectName: string) {
  return /^(?:@[a-z\d\-*~][a-z\d\-*._~]*\/)?[a-z\d\-~][a-z\d\-._~]*$/.test(projectName)
}

function toValidPackageName(projectName: string) {
  return projectName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^[._]/, '')
    .replace(/[^a-z\d\-~]+/g, '-')
}

function copyDir(srcDir: string, destDir: string) {
  fs.mkdirSync(destDir, { recursive: true })
  for (const file of fs.readdirSync(srcDir)) {
    const srcFile = path.resolve(srcDir, file)
    const destFile = path.resolve(destDir, file)
    copy(srcFile, destFile)
  }
}

function isEmpty(path: string) {
  const files = fs.readdirSync(path)
  return files.length === 0 || (files.length === 1 && files[0] === '.git')
}

function emptyDir(dir: string) {
  if (!fs.existsSync(dir)) {
    return
  }
  for (const file of fs.readdirSync(dir)) {
    if (file === '.git') {
      continue
    }
    fs.rmSync(path.resolve(dir, file), { recursive: true, force: true })
  }
}

interface PkgInfo {
  name: string
  version: string
}

function pkgFromUserAgent(userAgent: string | undefined): PkgInfo | undefined {
  if (!userAgent) return undefined
  const pkgSpec = userAgent.split(' ')[0]
  const pkgSpecArr = pkgSpec.split('/')
  return {
    name: pkgSpecArr[0],
    version: pkgSpecArr[1],
  }
}

init().catch(e => {
  console.error(e)
})
