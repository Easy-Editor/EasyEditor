/// <reference types="vite/client" />

interface Window {
  readonly __EASY_EDITOR_E2E__?: Readonly<{
    getEngineState: () => 'created' | 'initializing' | 'ready' | 'disposing' | 'disposed' | 'failed'
  }>
}
