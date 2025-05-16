import { type PluginCreator, TRANSFORM_STAGE, clipboard, insertChildren } from '@easy-editor/core'
import { HOTKEY_MAP } from './const'
import { isFormEvent } from './utils'

export type HotkeyCustomization = {
  enabled?: boolean
  keys?: string[]
}

export type HotkeyConfigItem = boolean | HotkeyCustomization

export type HotkeyConfig = {
  [key in keyof typeof HOTKEY_MAP]?: HotkeyConfigItem
}

interface HotkeyPluginOptions {
  config?: HotkeyConfig
}

const HotkeyPlugin: PluginCreator<HotkeyPluginOptions> = (options = {} as HotkeyPluginOptions) => {
  const { config = {} } = options

  return {
    name: 'HotkeyPlugin',
    deps: [],
    init(ctx) {
      const { hotkey, project, logger } = ctx
      const { designer } = project

      // Define the default handler functions
      const handlers = {
        HISTORY_UNDO: () => {
          const currentHistory = project.currentDocument?.history
          if (currentHistory?.isUndoable()) {
            currentHistory?.back()
          } else {
            logger.log('No operations to undo')
          }
        },

        HISTORY_REDO: () => {
          const currentHistory = project.currentDocument?.history
          if (currentHistory?.isRedoable()) {
            currentHistory?.forward()
          } else {
            logger.log('No operations to redo')
          }
        },

        LOCK_UNLOCK: () => {
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
        },

        SHOW_HIDE: () => {
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
        },

        COPY: (e: KeyboardEvent) => {
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
        },

        CUT: (e: KeyboardEvent) => {
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
        },

        PASTE: (e: KeyboardEvent) => {
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
                // Additional logic if needed
              }
            }
          })
        },

        DELETE: (e: KeyboardEvent) => {
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
        },

        CLEAR_SELECTION: (e: KeyboardEvent) => {
          const selection = designer.selection

          if (isFormEvent(e) || !selection) {
            return
          }

          selection.clear()
        },
      }

      // 根据 config 处理 hotkey 的绑定
      Object.entries(HOTKEY_MAP).forEach(([action, defaultKeys]) => {
        const actionKey = action as keyof typeof HOTKEY_MAP
        const customConfig = config[actionKey]

        let isEnabled = true
        let keysToUse = defaultKeys

        if (customConfig !== undefined) {
          if (typeof customConfig === 'boolean') {
            isEnabled = customConfig
          } else {
            isEnabled = customConfig.enabled !== false
            if (customConfig.keys && customConfig.keys.length > 0) {
              keysToUse = customConfig.keys
            }
          }
        }

        if (!isEnabled) {
          logger.log(`Hotkey ${actionKey} is disabled`)
          return
        }

        if (keysToUse.length > 0 && handlers[actionKey]) {
          hotkey.bind(keysToUse, handlers[actionKey])
        }
      })
    },
  }
}

export default HotkeyPlugin
