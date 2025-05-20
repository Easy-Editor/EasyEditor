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
      const { hotkey, designer } = ctx

      const moveNode = (type: 'up' | 'down' | 'left' | 'right', step = 1) => {
        const selectedNodes = designer.selection.getTopNodes(false)
        if (selectedNodes.length === 0) return

        for (const node of selectedNodes) {
          let { x, y } = node.getDashboardRect()
          switch (type) {
            case 'up':
              y -= step
              break
            case 'down':
              y += step
              break
            case 'left':
              x -= step
              break
            case 'right':
              x += step
              break
          }
          node.updateDashboardRect({
            x,
            y,
          })
        }
      }

      hotkey.bind(HOTKEY_MAP.UP, () => moveNode('up'))
      hotkey.bind(HOTKEY_MAP.DOWN, () => moveNode('down'))
      hotkey.bind(HOTKEY_MAP.LEFT, () => moveNode('left'))
      hotkey.bind(HOTKEY_MAP.RIGHT, () => moveNode('right'))
    },
  }
}

export default HotKeyMoveNodePlugin
