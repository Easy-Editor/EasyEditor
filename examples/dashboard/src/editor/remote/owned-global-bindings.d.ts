import type { RemoteAccessRequest } from '@easy-editor/core/instance'

export interface OwnedGlobalBindingsOptions {
  readonly bindings: Readonly<Record<string, unknown>>
  readonly realm: object
}

export declare class OwnedGlobalBindings {
  constructor(options: OwnedGlobalBindingsOptions)
  install(perform: (request: RemoteAccessRequest, effect: () => unknown) => unknown): void
  dispose(): void
}
