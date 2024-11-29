import type { Designer } from '../designer'
import type { ComponentMetadata, Configure, FieldConfig } from './meta'

import { createEventBus } from '../utils'

export enum COMPONENT_META_EVENT {
  CHANGE = 'componentMeta:metadata.change',
}

export class ComponentMeta {
  readonly isComponentMeta = true

  private emitter = createEventBus('ComponentMeta')

  private _componentName?: string

  get componentName(): string {
    return this._componentName!
  }

  private _isContainer?: boolean

  get isContainer() {
    return this._isContainer!
  }

  private _descriptor?: string

  get descriptor(): string | undefined {
    return this._descriptor
  }

  private _metadata?: ComponentMetadata

  get configure(): FieldConfig[] {
    const config = this._metadata?.configure
    return Array.isArray(config) ? config : config?.props || []
  }

  private _title?: string

  get title(): string {
    return this._title || this.componentName
  }

  get icon() {
    return this._metadata?.icon
  }

  get isOnlyFieldConfig() {
    const config = this._metadata?.configure
    return Array.isArray(config)
  }

  get advanced() {
    if (this.isOnlyFieldConfig) {
      return {}
    }

    return (this._metadata!.configure as Configure)?.advanced || {}
  }

  get snippets() {
    return this._metadata?.snippets || []
  }

  constructor(
    readonly designer: Designer,
    metadata: ComponentMetadata,
  ) {
    this.parseMetadata(metadata)
  }

  private parseMetadata(metadata: ComponentMetadata) {
    const { componentName } = metadata
    this._metadata = metadata
    this._componentName = componentName

    const { title, configure = {} } = this._metadata
    if (title) {
      this._title = title
    }

    if (!this.isOnlyFieldConfig) {
      const { component } = configure as Configure
      if (component) {
        this._isContainer = !!component.isContainer
        this._descriptor = component.descriptor
      } else {
        this._isContainer = false
      }
    }

    this.emitter.emit(COMPONENT_META_EVENT.CHANGE)
  }

  refreshMetadata() {
    this.parseMetadata(this.getMetadata())
  }

  setMetadata(metadata: ComponentMetadata) {
    this.parseMetadata(metadata)
  }

  getMetadata() {
    return this._metadata!
  }

  onMetadataChange(fn: (args: any) => void) {
    this.emitter.on(COMPONENT_META_EVENT.CHANGE, fn)
    return () => {
      this.emitter.off(COMPONENT_META_EVENT.CHANGE, fn)
    }
  }
}

export function isComponentMeta(obj: any): obj is ComponentMeta {
  return obj && obj.isComponentMeta
}
