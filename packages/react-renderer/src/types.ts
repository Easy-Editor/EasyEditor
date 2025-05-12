import type {
  BaseRendererProps,
  BaseRendererComponent as IBaseRendererComponent,
  BaseRendererContext as IBaseRendererContext,
  BaseRendererInstance as IBaseRendererInstance,
  RendererComponent as IRendererComponent,
  RendererComponentInstance as IRendererComponentInstance,
  RendererProps,
  RendererState,
} from '@easy-editor/renderer-core'
import type { Component } from 'react'

export * from '@easy-editor/renderer-core'

export type RendererComponent = IRendererComponent<Component<RendererProps, RendererState>>

export type RendererComponentInstance = IRendererComponentInstance<Component<BaseRendererProps, RendererState>>

export type BaseRendererContext = IBaseRendererContext<Component<BaseRendererProps, Record<string, any>, any>>

export type BaseRendererComponent = IBaseRendererComponent<Component<BaseRendererProps, Record<string, any>, any>>

export type BaseRendererInstance = IBaseRendererInstance<Component<BaseRendererProps, Record<string, any>, any>>
