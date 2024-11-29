import { DEV } from '..'

const logColorMap = {
  log: '#1677FF',
  error: '#FF4D4F',
  warn: '#FAAD14',
} as const

const print = (method: keyof typeof logColorMap, title: string, args: any[]) => {
  if (!DEV) return

  const logPrefix = [
    `%c${title}`,
    `background:${logColorMap?.[method]};border-radius: 0.5em;color: white;font-weight: bold;padding: 2px 0.5em`,
  ]

  return console[method](...logPrefix, ...args)
}

export interface Logger {
  log: (...args: Parameters<(typeof console)['log']>) => void
  error: (...args: Parameters<(typeof console)['error']>) => void
  warn: (...args: Parameters<(typeof console)['warn']>) => void
}

export const createLogger = (title: string) => ({
  log: (...args: Parameters<(typeof console)['log']>) => print('log', title, args),
  error: (...args: Parameters<(typeof console)['error']>) => print('error', title, args),
  warn: (...args: Parameters<(typeof console)['warn']>) => print('warn', title, args),
})

/**
 * internal global logger
 */
export const logger = createLogger('Core')
