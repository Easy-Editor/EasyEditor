import { config } from '@easy-editor/core'

export * from './engine'

export const version = '_EASY_EDITOR_ENGINE_VERSION_'
config.set('ENGINE_VERSION', version)

console.log(
  `%c EasyEditor Engine %c v${version} `,
  'padding: 2px 1px; border-radius: 3px 0 0 3px; color: #fff; background: #606060; font-weight: bold;',
  'padding: 2px 1px; border-radius: 0 3px 3px 0; color: #fff; background: #42c02e; font-weight: bold;',
)
