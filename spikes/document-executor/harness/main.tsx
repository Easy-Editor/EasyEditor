import '/src/styles/global.css'

import { createInMemoryDashboardAgentHostFactory } from '@easy-editor/dashboard-agent-host'
import { createRoot } from 'react-dom/client'
import { editorReady, loadDashboardEditorDraft } from '/src/editor/index.ts'
import { remoteMaterialsConfig, remoteSettersConfig } from '/src/editor/remote/config.ts'
import { engine } from '/src/editor/runtime.ts'
import { Renderer } from '/src/pages/editor/Renderer.tsx'

const documentExecutorBuild = Object.freeze({
  viteE2E: import.meta.env.VITE_E2E === '1',
  remoteResourcesDisabled:
    remoteMaterialsConfig.filter(config => config.enabled).length === 0 &&
    remoteSettersConfig.filter(config => config.enabled).length === 0,
  enabledRemoteMaterialCount: remoteMaterialsConfig.filter(config => config.enabled).length,
  enabledRemoteSetterCount: remoteSettersConfig.filter(config => config.enabled).length,
})
const documentExecutorBridge = Object.freeze({
  editorReady,
  loadDashboardEditorDraft,
  engine,
  createInMemoryDashboardAgentHostFactory,
})
;(
  globalThis as typeof globalThis & {
    __EASY_EDITOR_DOCUMENT_EXECUTOR_BUILD__?: typeof documentExecutorBuild
    __EASY_EDITOR_DOCUMENT_EXECUTOR_BRIDGE__?: typeof documentExecutorBridge
  }
).__EASY_EDITOR_DOCUMENT_EXECUTOR_BUILD__ = documentExecutorBuild
;(
  globalThis as typeof globalThis & {
    __EASY_EDITOR_DOCUMENT_EXECUTOR_BRIDGE__?: typeof documentExecutorBridge
  }
).__EASY_EDITOR_DOCUMENT_EXECUTOR_BRIDGE__ = documentExecutorBridge

const root = document.getElementById('root')
if (!root) throw new Error('Document Executor Harness root is missing')

await editorReady
createRoot(root).render(
  <section className='document-executor-harness' data-document-executor-harness='ready'>
    <Renderer />
  </section>,
)
