export interface OnlineComponentActivationMarker {
  readonly state: 'pending'
  readonly revisionKey: string
  readonly surfaceId: string
  readonly activationId: string
  readonly nonce: string
  readonly startedAt: number
}

export interface OnlineComponentActivationMarkerStore {
  read(key: string): OnlineComponentActivationMarker | undefined
  write(key: string, marker: OnlineComponentActivationMarker): void
  clear(key: string, marker: OnlineComponentActivationMarker): void
  quarantine(revisionKey: string, marker: OnlineComponentActivationMarker): void
}

export type OnlineComponentActivationDecision =
  | Readonly<{
      activate: true
      state: 'pending'
      marker: OnlineComponentActivationMarker
    }>
  | Readonly<{
      activate: false
      state: 'quarantined' | 'safe-boot-skipped'
      reason: 'stale-pending-marker' | 'safe-boot'
    }>

export interface OnlineComponentActivationLifecycle {
  begin(): OnlineComponentActivationDecision
  heartbeat(): false
  completeRehydrate(): boolean
  fail(): boolean
  dispose(): void
  getDiagnostics(): Readonly<{
    state: 'idle' | 'pending' | 'active' | 'quarantined' | 'safe-boot-skipped' | 'disposed'
    revisionKey: string
    key: string
  }>
}

export interface OnlineComponentActivationLifecycleOptions {
  readonly markerStore: OnlineComponentActivationMarkerStore
  readonly revisionKey: string
  readonly surfaceId: string
  readonly activationId: string
  readonly nonce: string
  readonly safeBoot?: boolean
  readonly now?: () => number
}

export declare const createActivationMarkerKey: (input: {
  readonly revisionKey: string
  readonly surfaceId: string
}) => string
export declare const createOnlineComponentActivationLifecycle: (
  options: OnlineComponentActivationLifecycleOptions,
) => OnlineComponentActivationLifecycle
