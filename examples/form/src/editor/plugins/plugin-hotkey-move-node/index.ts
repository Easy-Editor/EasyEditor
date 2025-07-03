import type { PluginCreator } from '@easy-editor/core'

export const HOTKEY_MAP = {
  UP: ['up'],
  DOWN: ['down'],
  LEFT: ['left'],
  RIGHT: ['right'],
}

const HotKeyMoveNodePlugin: PluginCreator = () => {
  return {
    name: 'HotKeyMoveNodePlugin',
    deps: [],
    init(ctx) {
      // 表单场景暂不支持节点移动功能
      console.log('HotKeyMoveNodePlugin initialized but disabled for form scenario')
    },
  }
}

export default HotKeyMoveNodePlugin
