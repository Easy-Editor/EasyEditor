/**
 * TODO: 从 core 中抽离出来
 */

import { config } from '..'

export * from './engine'

export const version = '_EASY_EDITOR_VERSION_'
config.set('VERSION', version)

console.log(
  `%c EasyEditor %c v${version} `,
  'padding: 2px 1px; border-radius: 3px 0 0 3px; color: #fff; background: #5584ff; font-weight: bold;',
  'padding: 2px 1px; border-radius: 0 3px 3px 0; color: #fff; background: #42c02e; font-weight: bold;',
)
