import { action, computed, observable } from 'mobx'
import { DESIGNER_EVENT, type Designer, type Editor, type Node, type Selection, generateSessionId } from '../..'
import type { SettingTopEntry } from './setting-top-entry'

export class SettingsManager {
  private _sessionId = ''

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

  private disposeListener: () => void

  private designer?: Designer

  constructor(readonly editor: Editor) {
    this.init()
  }

  private async init() {
    const setupSelection = (selection?: Selection) => {
      if (selection) {
        this.setup(selection.getNodes())
      } else {
        this.setup([])
      }
    }
    const designer = await this.editor.onceGot<Designer>('designer')!
    this.designer = designer
    setupSelection(designer.selection)
    this.disposeListener = designer.onEvent(DESIGNER_EVENT.SELECTION_CHANGE, () => {
      setupSelection(designer.selection)
    })!
  }

  @action
  private setup(nodes: Node[]) {
    // check nodes change
    const sessionId = generateSessionId(nodes)
    if (sessionId === this._sessionId) {
      return
    }
    this._sessionId = sessionId
    if (nodes.length < 1) {
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

  purge() {
    this.disposeListener()
  }
}
