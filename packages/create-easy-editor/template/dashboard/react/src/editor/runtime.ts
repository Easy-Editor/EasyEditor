import { type EngineInstance, createEngine } from '@easy-editor/core/instance'

export const engine: EngineInstance = createEngine({
  trustPolicy: 'legacyTrusted',
  hostWindow: window,
})

export const project = engine.project
