import type { OnlineComponentProtocolIdentity } from './surface-protocol.mjs'

export declare const createOnlineComponentSandboxCsp: (nonce: string) => string
export declare const createOnlineComponentSandboxDocument: (identity: OnlineComponentProtocolIdentity) => string
