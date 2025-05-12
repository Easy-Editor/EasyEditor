import type {
  BaseRendererProps,
  BaseRendererComponent as IBaseRendererComponent,
  BaseRendererInstance as IBaseRendererInstance,
  RendererComponent as IRendererComponent,
  RendererProps,
  RendererState,
} from '@easy-editor/renderer-core'
import type { Component } from 'react'

export type RendererComponent = IRendererComponent<Component<RendererProps, RendererState>>

export type BaseRendererComponent = IBaseRendererComponent<Component<BaseRendererProps, Record<string, any>, any>>

export type BaseRendererInstance = IBaseRendererInstance<Component<BaseRendererProps, Record<string, any>, any>>
