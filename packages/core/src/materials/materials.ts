import { action, computed, observable } from 'mobx'
import type { Designer } from '../designer'
import type { Component, ComponentMetadata, Editor } from '../types'
import { ComponentMeta, isComponentMeta } from './component-meta'

export class Materials {
  @observable.ref private accessor _componentMetasMap = new Map<string, ComponentMeta>()

  private _lostComponentMetasMap = new Map<string, ComponentMeta>()

  get designer() {
    return this.editor.get<Designer>('designer')!
  }

  constructor(readonly editor: Editor) {}

  buildComponentMetasMap = (metas: ComponentMetadata[]) => {
    for (const meta of metas) {
      this.createComponentMeta(meta)
    }
  }

  @action
  createComponentMeta(data: ComponentMetadata) {
    const key = data.componentName
    if (!key) {
      return null
    }
    let meta = this._componentMetasMap.get(key)
    if (meta) {
      meta.setMetadata(data)

      this._componentMetasMap.set(key, meta)
    } else {
      meta = this._lostComponentMetasMap.get(key)

      if (meta) {
        meta.setMetadata(data)
        this._lostComponentMetasMap.delete(key)
      } else {
        meta = new ComponentMeta(this.designer, data)
      }

      this._componentMetasMap.set(key, meta)
    }

    return meta
  }

  @action
  removeComponentMeta(componentName: string): boolean {
    if (!componentName) {
      return false
    }

    const removed = this._componentMetasMap.delete(componentName)
    this._lostComponentMetasMap.delete(componentName)

    // 触发更新
    if (removed) {
      this.refreshComponentMetasMap()
    }

    return removed
  }

  getComponentMeta(componentName: string, generateMetadata?: () => ComponentMetadata | null): ComponentMeta {
    if (this._componentMetasMap.has(componentName)) {
      return this._componentMetasMap.get(componentName)!
    }

    if (this._lostComponentMetasMap.has(componentName)) {
      return this._lostComponentMetasMap.get(componentName)!
    }

    const meta = new ComponentMeta(this.designer, {
      componentName,
      ...(generateMetadata ? generateMetadata() : null),
    })

    this._lostComponentMetasMap.set(componentName, meta)

    return meta
  }

  getComponentSnippets() {
    return Array.from(this._componentMetasMap.values()).flatMap(meta => meta.snippets)
  }

  getComponentMetasMap() {
    return this._componentMetasMap
  }

  @computed
  get componentMetasMap() {
    const maps: Record<string, ComponentMetadata> = {}
    this._componentMetasMap.forEach((config, key) => {
      const metaData = config.getMetadata()
      maps[key] = metaData
    })
    return maps
  }

  @computed
  get componentsMap(): { [key: string]: Component } {
    const maps: any = {}
    this._componentMetasMap.forEach((config, key) => {
      const metaData = config.getMetadata()
      if (metaData.devMode === 'lowCode') {
        maps[key] = metaData.schema
      } else {
        const { view } = config.advanced
        if (view) {
          maps[key] = view
        } else {
          // maps[key] = config.npm
        }
      }
    })
    return maps
  }

  /**
   * 刷新 componentMetasMap，可间接触发模拟器里的 buildComponents
   */
  refreshComponentMetasMap() {
    this._componentMetasMap = new Map(this._componentMetasMap)
  }

  isComponentMeta(obj: any) {
    return isComponentMeta(obj)
  }
}
