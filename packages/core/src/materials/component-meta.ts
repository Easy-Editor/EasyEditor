import type { Designer } from '../designer'
import type { ComponentMetadata } from '../types'
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

  private _isMinimalRenderUnit?: boolean

  get isMinimalRenderUnit(): boolean {
    return this._isMinimalRenderUnit || false
  }

  private _descriptor?: string

  get descriptor() {
    return this._descriptor
  }

  private _metadata?: ComponentMetadata

  get configure() {
    return this._metadata?.configure?.props || []
  }

  private _title?: string

  get title(): string {
    return this._title || this.componentName
  }

  get icon() {
    return this._metadata?.icon
  }

  get advanced() {
    return this._metadata?.configure?.advanced || {}
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

    const { component } = configure
    if (component) {
      this._isContainer = !!component.isContainer
      this._descriptor = component.descriptor
      this._isMinimalRenderUnit = component.isMinimalRenderUnit
    } else {
      this._isContainer = false
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
