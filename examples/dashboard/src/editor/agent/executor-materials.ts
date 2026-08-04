import type { EngineInstance } from '@easy-editor/core/instance'

/**
 * Normal editor builds discover project materials through the remote material
 * manager. The immutable Document Executor replaces this no-op module at build
 * time with its pinned, bundled material registry.
 */
export const registerBundledExecutorMaterials = (_engine: EngineInstance): void => undefined
