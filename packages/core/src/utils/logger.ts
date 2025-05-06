import { isObject } from './is'

export type Level = 'debug' | 'log' | 'info' | 'warn' | 'error'

interface Options {
  /**
   * 日志级别
   * @default 'warn'
   */
  level: Level

  /**
   * 业务名称
   * @default '*'
   */
  bizName: string
}

const levels: Record<string, number> = {
  debug: -1,
  log: 0,
  info: 0,
  warn: 1,
  error: 2,
}

const bizNameColors = [
  '#daa569',
  '#00ffff',
  '#385e0f',
  '#7fffd4',
  '#00c957',
  '#b0e0e6',
  '#4169e1',
  '#6a5acd',
  '#87ceeb',
  '#ffff00',
  '#e3cf57',
  '#ff9912',
  '#eb8e55',
  '#ffe384',
  '#40e0d0',
  '#a39480',
  '#d2691e',
  '#ff7d40',
  '#f0e68c',
  '#bc8f8f',
  '#c76114',
  '#734a12',
  '#5e2612',
  '#0000ff',
  '#3d59ab',
  '#1e90ff',
  '#03a89e',
  '#33a1c9',
  '#a020f0',
  '#a066d3',
  '#da70d6',
  '#dda0dd',
  '#688e23',
  '#2e8b57',
]

const bodyColors: Record<string, string> = {
  debug: '#fadb14',
  log: '#8c8c8c',
  info: '#52c41a',
  warn: '#fa8c16',
  error: '#ff4d4f',
}

const levelMarks: Record<string, string> = {
  debug: 'debug',
  log: 'log',
  info: 'info',
  warn: 'warn',
  error: 'error',
}

const outputFunction: Record<string, any> = {
  debug: console.log,
  log: console.log,
  info: console.log,
  warn: console.warn,
  error: console.error,
}

const bizNameColorConfig: Record<string, string> = {}

const shouldOutput = (logLevel: string, targetLevel: string, bizName: string, targetBizName: string) => {
  const isLevelFit = (levels as any)[targetLevel] <= (levels as any)[logLevel]
  const isBizNameFit = targetBizName === '*' || bizName.indexOf(targetBizName) > -1
  return isLevelFit && isBizNameFit
}

const output = (logLevel: string, bizName: string) => {
  return (...args: any[]) => {
    return outputFunction[logLevel]?.apply(console, getLogArgs(args, bizName, logLevel))
  }
}

const getColor = (bizName: string) => {
  if (!bizNameColorConfig[bizName]) {
    const color = bizNameColors[Object.keys(bizNameColorConfig).length % bizNameColors.length]
    bizNameColorConfig[bizName] = color
  }
  return bizNameColorConfig[bizName]
}

const getLogArgs = (args: any, bizName: string, logLevel: string) => {
  const color = getColor(bizName)
  const bodyColor = bodyColors[logLevel]

  const argsArray = args[0]
  let prefix = `%c[${bizName}]%c[${levelMarks[logLevel]}]:`
  argsArray.forEach((arg: any) => {
    if (isObject(arg)) {
      prefix += '%o'
    } else {
      prefix += '%s'
    }
  })
  let processedArgs = [prefix, `color: ${color}`, `color: ${bodyColor}`]
  processedArgs = processedArgs.concat(argsArray)
  return processedArgs
}

const parseLogConf = (logConf: string, options: Options): { level: string; bizName: string } => {
  if (!logConf) {
    return {
      level: options.level,
      bizName: options.bizName,
    }
  }
  if (logConf.indexOf(':') > -1) {
    const pair = logConf.split(':')
    return {
      level: pair[0],
      bizName: pair[1] || '*',
    }
  }
  return {
    level: logConf,
    bizName: '*',
  }
}

const defaultOptions: Options = {
  level: 'warn',
  bizName: '*',
}

export class Logger {
  /**
   * 业务名称
   */
  bizName: string

  /**
   * 目标日志的bizName
   */
  targetBizName: string

  /**
   * 目标日志的level
   */
  targetLevel: string

  constructor(_options: Partial<Options>) {
    const options = { ...defaultOptions, ..._options }
    const _location = location || ({} as any)
    /**
     * __logConf__ 格式为 logLevel[:bizName], bizName is used as: targetBizName like '%bizName%'
     *   1. __logConf__=log  or __logConf__=warn,  etc.
     *   2. __logConf__=log:*  or __logConf__=warn:*,  etc.
     *   3. __logConf__=log:bizName  or __logConf__=warn:partOfBizName,  etc.
     */
    const logConf = (/__(?:logConf|logLevel)__=([^#/&]*)/.exec(_location.href) || [])[1]
    const targetOptions = parseLogConf(logConf, options)

    this.bizName = options.bizName
    this.targetBizName = targetOptions.bizName
    this.targetLevel = targetOptions.level
  }

  debug(...args: any[]) {
    if (!shouldOutput('debug', this.targetLevel, this.bizName, this.targetBizName)) {
      return
    }
    return output('debug', this.bizName)(args)
  }

  log(...args: any[]) {
    if (!shouldOutput('log', this.targetLevel, this.bizName, this.targetBizName)) {
      return
    }
    return output('log', this.bizName)(args)
  }

  info(...args: any[]) {
    if (!shouldOutput('info', this.targetLevel, this.bizName, this.targetBizName)) {
      return
    }
    return output('info', this.bizName)(args)
  }

  warn(...args: any[]) {
    if (!shouldOutput('warn', this.targetLevel, this.bizName, this.targetBizName)) {
      return
    }
    return output('warn', this.bizName)(args)
  }

  error(...args: any[]) {
    if (!shouldOutput('error', this.targetLevel, this.bizName, this.targetBizName)) {
      return
    }
    return output('error', this.bizName)(args)
  }
}

export const createLogger = (config: string | { level: Level; bizName: string }) => {
  if (typeof config === 'string') {
    return new Logger({ bizName: config })
  }
  return new Logger(config)
}
