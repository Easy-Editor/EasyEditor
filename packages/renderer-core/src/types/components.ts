import type { NodeSchema } from '@easy-editor/core'

/**
 * Minimal framework-agnostic component interface
 * Contains only essential shared properties across frameworks
 */
export interface GeneralComponent<P = Record<string, unknown>, S = Record<string, unknown>, SS = any> {
  readonly props: Readonly<P> & Readonly<{ children?: any | undefined }>
  state: Readonly<S>
  refs: Record<string, any>
  context: any
  setState<K extends keyof S>(
    state: ((prevState: Readonly<S>, props: Readonly<P>) => Pick<S, K> | S | null) | (Pick<S, K> | S | null),
    callback?: () => void,
  ): void
  forceUpdate(callback?: () => void): void
  render?(): any
}

export interface FaultComponentProps extends NodeSchema {
  error?: Error | string
}

export interface NotFoundComponentProps extends NodeSchema {
  enableStrictNotFoundMode?: boolean
}
