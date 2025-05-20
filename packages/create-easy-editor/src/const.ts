import colors from 'picocolors'

const { blue, cyan, gray } = colors

export const renameFiles: Record<string, string | undefined> = {
  _gitignore: '.gitignore',
}

export const defaultTargetDir = 'easy-editor'

export const helpMessage = `\
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
  variants: Variant[]
}

type Variant = {
  name: string
  display: string
  color: ColorFunc
}

export const FRAMEWORKS: Framework[] = [
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

export const TEMPLATES = FRAMEWORKS.map(f => f.variants.map(v => v.name)).reduce((a, b) => a.concat(b), [])

export const SCENARIOS: Variant[] = [
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

export const APPLICATIONS = SCENARIOS.map(s => s.name)
