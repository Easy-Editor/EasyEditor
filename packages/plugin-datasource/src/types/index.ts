import type { DataHandler } from './data-source-runtime'

export * from './data-source'
export * from './data-source-handlers'
export * from './data-source-interpret'
export * from './data-source-runtime'

export interface ExtraConfig {
  defaultDataHandler?: DataHandler
}
