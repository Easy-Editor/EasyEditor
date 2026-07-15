import { type PluginCreator, assertLegacyTrustedPluginContext } from '@easy-editor/core/instance'

export const HOTKEY_MAP = {
  UP: ['up'],
  DOWN: ['down'],
  LEFT: ['left'],
  RIGHT: ['right'],
}

const HotKeyMoveNodePlugin: PluginCreator = () => {
  type HotkeyBinding = readonly [keys: string[], handler: () => void]

  return {
    name: 'HotKeyMoveNodePlugin',
    deps: [],
    init(ctx) {
      assertLegacyTrustedPluginContext(ctx)
      const { hotkey, project } = ctx
      const { designer } = project

      const ownBinding = (...binding: HotkeyBinding) => {
        const release = hotkey.acquireBinding(...binding)
        try {
          ctx.onDispose(release)
        } catch (error) {
          try {
            release()
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              'Move-node hotkey ownership registration failed to roll back',
            )
          }
          throw error
        }
      }

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

      const nextBindings: HotkeyBinding[] = [
        [HOTKEY_MAP.UP, () => moveNode('up')],
        [HOTKEY_MAP.DOWN, () => moveNode('down')],
        [HOTKEY_MAP.LEFT, () => moveNode('left')],
        [HOTKEY_MAP.RIGHT, () => moveNode('right')],
      ]
      for (const binding of nextBindings) ownBinding(...binding)
    },
  }
}

export default HotKeyMoveNodePlugin
