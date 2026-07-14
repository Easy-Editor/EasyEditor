import { type PluginCreator, assertLegacyTrustedPluginContext } from '@easy-editor/core/instance'

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
      assertLegacyTrustedPluginContext(ctx)
      const { hotkey, project } = ctx
      const { designer } = project

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

      const bindings = [
        [HOTKEY_MAP.UP, () => moveNode('up')],
        [HOTKEY_MAP.DOWN, () => moveNode('down')],
        [HOTKEY_MAP.LEFT, () => moveNode('left')],
        [HOTKEY_MAP.RIGHT, () => moveNode('right')],
      ] as const
      for (const [keys, handler] of bindings) hotkey.bind(keys, handler)
      ctx.onDispose(() => {
        for (const [keys, handler] of bindings) hotkey.unbind(keys, handler)
      })
    },
  }
}

export default HotKeyMoveNodePlugin
