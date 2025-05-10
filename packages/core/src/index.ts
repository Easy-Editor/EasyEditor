import { config } from './config'

export * from './config'
export * from './designer'
export * from './document'
export * from './materials'
export * from './plugin'
export * from './project'
export * from './setters'
export * from './simulator'
export * from './types'
export * from './utils'

export const DEV = '_EASY_EDITOR_DEV_'

export const version = '_EASY_EDITOR_VERSION_'
config.set('CORE_VERSION', version)
