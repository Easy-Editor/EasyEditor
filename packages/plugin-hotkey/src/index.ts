import type { PluginCreator } from '@easy-editor/core'
import { HOTKEY_MAP } from './const'

interface HotkeyPluginOptions {
  copy?: boolean
  paste?: boolean
}

const HotkeyPlugin: PluginCreator<HotkeyPluginOptions> = options => {
  const { copy = false } = options || {}

  return {
    name: 'HotkeyPlugin',
    deps: [],
    init(ctx) {
      const { hotkey, project, logger, designer } = ctx

      hotkey.bind(HOTKEY_MAP.HISTORY_UNDO, () => {
        const currentHistory = project.currentDocument?.history
        if (currentHistory?.isUndoable()) {
          currentHistory?.back()
        } else {
          logger.log('No operations to undo')
        }
      })

      hotkey.bind(HOTKEY_MAP.HISTORY_REDO, () => {
        const currentHistory = project.currentDocument?.history
        if (currentHistory?.isRedoable()) {
          currentHistory?.forward()
        } else {
          logger.log('No operations to redo')
        }
      })

      hotkey.bind(HOTKEY_MAP.LOCK_UNLOCK, () => {
        const selection = designer.selection
        const doc = project.currentDocument

        for (const nodeId of selection.selected) {
          const node = doc?.getNode(nodeId)
          if (node?.isLocked) {
            node.lock(false)
            logger.log('Lock')
          } else {
            node?.lock(true)
            logger.log('Unlock')
          }
        }

        selection.clear()

        return false
      })

      hotkey.bind(HOTKEY_MAP.SHOW_HIDE, () => {
        const selection = designer.selection
        const doc = project.currentDocument

        for (const nodeId of selection.selected) {
          const node = doc?.getNode(nodeId)
          if (node?.isHidden) {
            node.hide(false)
            logger.log('Show')
          } else {
            node?.hide(true)
            logger.log('Hide')
          }
        }

        selection.clear()

        return false
      })

      hotkey.bind(HOTKEY_MAP.COPY, async () => {
        // const data = await project.currentDocument?.copyToSchema()
        // if (data) {
        //   navigator.clipboard
        //     .writeText(data)
        //     .then(() => {
        //       logger.log('复制成功')
        //     })
        //     .catch(() => {
        //       logger.error('复制失败')
        //     })
        // }

        return false
      })

      hotkey.bind(HOTKEY_MAP.PASTE, async () => {
        // const data = await navigator.clipboard.readText().catch(() => logger.error('粘贴失败'))
        // const pasteNodeIds = project.currentDocument?.pasteFromSchema(data)
        // if (pasteNodeIds) {
        //   logger.log('粘贴成功')
        //   designer.selection.batchSelect(pasteNodeIds)
        // } else {
        //   logger.error('粘贴失败')
        // }

        return false
      })
    },
  }
}

export default HotkeyPlugin
