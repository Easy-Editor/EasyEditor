import { configure } from 'mobx'

export * from './designer'
export * from './document'
export * from './editor'
export * from './plugin'
export * from './project'
export * from './setter-manager'
export * from './simulator'
export * from './types'
export * from './utils'

export const DEV = '_EASY_EDITOR_DEV_'

// TODO
configure({
  // 仅能通过 action 来修改响应式数据
  enforceActions: 'always',
  // lint
  // computedRequiresReaction: true,
  // reactionRequiresObservable: true,
  // observableRequiresReaction: true,
  // disableErrorBoundaries: true,
})
