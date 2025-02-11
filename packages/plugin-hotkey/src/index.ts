import { type PluginCreator, TRANSFORM_STAGE, clipboard, insertChildren } from '@easy-editor/core'
import { HOTKEY_MAP } from './const'
import { isFormEvent } from './utils'

const HotkeyPlugin: PluginCreator = () => {
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
      })

      hotkey.bind(HOTKEY_MAP.COPY, e => {
        const doc = project.currentDocument
        if (isFormEvent(e) || !doc) {
          return
        }

        const selected = designer.selection.getTopNodes(false)
        if (!selected || selected.length < 1) {
          return
        }

        const componentsTree = selected.map(item => item?.export(TRANSFORM_STAGE.CLONE))
        const data = { type: 'NodeSchema', componentsMap: {}, componentsTree }

        clipboard.setData(data)
      })

      hotkey.bind(HOTKEY_MAP.CUT, e => {
        const doc = project.currentDocument
        if (isFormEvent(e) || !doc) {
          return
        }

        const selection = designer.selection
        const selected = selection.getTopNodes(false)
        if (!selected || selected.length < 1) {
          return
        }

        const componentsTree = selected.map(item => item?.export(TRANSFORM_STAGE.CLONE))
        const data = { type: 'NodeSchema', componentsMap: {}, componentsTree }

        clipboard.setData(data)

        for (const node of selected) {
          node?.parent?.select()
          node.remove()
        }
        selection.clear()
      })

      hotkey.bind(HOTKEY_MAP.PASTE, e => {
        const doc = project.currentDocument
        const selection = designer.selection

        if (isFormEvent(e) || !doc) {
          return
        }

        clipboard.waitPasteData(e, ({ componentsTree }) => {
          if (componentsTree) {
            const target = doc?.rootNode

            if (!target) {
              return
            }

            const nodes = insertChildren(target, componentsTree)
            if (nodes) {
              selection.selectAll(nodes.map(o => o.id))
            }
          }
        })
      })

      hotkey.bind(HOTKEY_MAP.DELETE, e => {
        const doc = project.currentDocument
        const selection = designer.selection

        if (isFormEvent(e) || !doc) {
          return
        }

        const nodes = selection.getTopNodes()
        for (const node of nodes) {
          node && doc?.removeNode(node)
        }
        selection.clear()
      })

      hotkey.bind(HOTKEY_MAP.CLEAR_SELECTION, e => {
        const selection = designer.selection

        if (isFormEvent(e) || !selection) {
          return
        }

        selection.clear()
      })
    },
  }
}

export default HotkeyPlugin
