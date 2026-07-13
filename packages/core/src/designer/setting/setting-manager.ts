import { action, computed, observable } from 'mobx'
import type { Node } from '../../document/node/node'
import type { Editor } from '../../types/editor'
import { DESIGNER_EVENT, type Designer } from '../designer'
import type { Selection } from '../selection'
import { type SettingTopEntry, generateSessionId } from './setting-top-entry'

export class SettingsManager {
  _sessionId = ''

  @observable.ref private accessor _settings: SettingTopEntry | undefined

  @computed
  get length(): number | undefined {
    return this._settings?.nodes.length
  }

  @computed
  get componentMeta() {
    return this._settings?.componentMeta
  }

  @computed
  get settings() {
    return this._settings
  }

  private disposeEditorListener?: () => void

  private disposeSelectionListener?: () => void

  private designer?: Designer

  constructor(readonly editor: Editor) {
    this.mount()
  }

  mount(): void {
    if (this.disposeEditorListener) return

    const setupSelection = (selection?: Selection) => {
      if (selection) {
        this.setup(selection.getNodes())
      } else {
        this.setup([])
      }
    }

    this.disposeEditorListener = this.editor.onGot<Designer>('designer', designer => {
      this.disposeSelectionListener?.()
      this.designer = designer
      setupSelection(designer.selection)
      this.disposeSelectionListener = designer.onEvent(DESIGNER_EVENT.SELECTION_CHANGE, () => {
        setupSelection(designer.selection)
      })
    })
  }

  @action
  setup(nodes: Node[]) {
    // check nodes change
    const sessionId = generateSessionId(nodes)
    if (sessionId === this._sessionId) {
      return
    }
    this._sessionId = sessionId

    // 当没有选中节点时，自动使用根节点
    if (nodes.length < 1) {
      const rootNode = this.designer?.project.currentDocument?.rootNode
      if (rootNode) {
        this._settings = rootNode.settingEntry
        return
      }
      this._settings = undefined
      return
    }

    if (!this.designer) {
      this.designer = nodes[0].document.designer
    }
    // 当节点只有一个时，复用 node 上挂载的 settingEntry，不会产生平行的两个实例，这样在整个系统中对
    // 某个节点操作的 SettingTopEntry 只有一个实例，后续的 getProp() 也会拿到相同的 SettingField 实例
    if (nodes.length === 1) {
      this._settings = nodes[0].settingEntry
    } else {
      this._settings = this.designer.createSettingEntry(nodes)
    }
  }

  @action
  purge(): void {
    this.disposeSelectionListener?.()
    this.disposeSelectionListener = undefined
    this.disposeEditorListener?.()
    this.disposeEditorListener = undefined
    this._sessionId = ''
    this._settings = undefined
    this.designer = undefined
  }
}
