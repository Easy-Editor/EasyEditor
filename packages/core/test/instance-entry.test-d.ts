// @ts-expect-error the legacy root facade must not expose the v2 instance factory
import { createEngine as legacyCreateEngine } from '@easy-editor/core'
import type * as instanceEntry from '@easy-editor/core/instance'
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  type Disposable,
  type EngineInstance,
  type EngineInstanceOptions,
  type EngineLifecycleState,
  type LegacyTrustedPluginContext,
  MaterialSource,
  type PluginContext,
  type PluginManager,
  type PluginRuntimeSnapshot,
  type RemoteAccessRequest,
  type RemoteAdapter,
  RemoteLoadError,
  SchemaValidator,
  TRANSFORM_STAGE,
  assertLegacyTrustedPluginContext,
  createEngine,
  resolveTrustPolicy,
  validateProjectSchema,
} from '@easy-editor/core/instance'

const remoteAdapter: RemoteAdapter = {
  init() {},
  request(request: RemoteAccessRequest) {
    return request.name
  },
  dispose() {},
}

const options: EngineInstanceOptions = {
  hostWindow: null,
  remoteAdapter,
  trustPolicy: 'agentRestricted',
}
const engine: EngineInstance = createEngine(options)
const pluginManager: PluginManager = engine.plugins
declare const pluginContext: PluginContext
pluginContext.config.get('designMode')
pluginContext.project.export()
const pluginHotkey = pluginContext.hotkey.bind('mod+s', () => {})
pluginHotkey.activate(true)
const pluginHotkeyLease: Disposable = pluginContext.hotkey.acquireBinding('mod+shift+s', () => {})
pluginHotkeyLease()
// @ts-expect-error a binding lease is disposal authority, not the Hotkey capability
pluginHotkeyLease.activate(true)
const pluginComponentMeta = pluginContext.materials.getComponentMeta('Text')
pluginComponentMeta.getMetadata()
// @ts-expect-error the policy-independent plugin contract does not expose raw Config internals
pluginContext.config.setEngineOptions({})
// @ts-expect-error the policy-independent plugin contract does not expose raw Project mutation methods
pluginContext.project.load()
// @ts-expect-error the policy-independent plugin contract does not expose reverse Designer authority
pluginContext.project.designer
// @ts-expect-error chained Hotkey registration must retain the finite plugin facade
pluginHotkey.mount(window)
// @ts-expect-error plugin material metadata cannot tear down engine-owned state
pluginComponentMeta.dispose()
const pluginSnapshot: PluginRuntimeSnapshot | undefined = pluginManager.get('example')
const lifecycleState: EngineLifecycleState = engine.lifecycleState
// @ts-expect-error lifecycle state is an engine-owned, read-only decision source
engine.lifecycleState = 'ready'
type HasEngineConstructor = 'EngineInstance' extends keyof typeof instanceEntry ? true : false
const hasEngineConstructor: false = false as HasEngineConstructor
// @ts-expect-error mutable compatibility services cannot be injected into a public instance
createEngine({ services: {} })
// @ts-expect-error the raw plugin manager is an implementation detail
engine.innerPlugins
// @ts-expect-error plugin lifecycle orchestration belongs to the engine
engine.plugins.init()
// @ts-expect-error mutable plugin registries are not part of the public capability
engine.plugins.registeredPlugins
// @ts-expect-error public plugin lookup returns immutable state, not a runtime lifecycle handle
engine.plugins.get('example')?.init()
// @ts-expect-error trust assertions are implementation details
engine.assertTrustBoundaryIntegrity('type-test')
// @ts-expect-error Agent capability hosting is not part of the framework entry
engine.agentCapabilities
const currentVersion: '1.0.0' = CURRENT_PROJECT_SCHEMA_VERSION
const prepared = validateProjectSchema(
  { componentsTree: [], version: currentVersion },
  resolveTrustPolicy('legacyTrusted'),
)
const validator = new SchemaValidator(resolveTrustPolicy('legacyTrusted'))
const transformStage = TRANSFORM_STAGE.RENDER
const materialSource = MaterialSource.REMOTE
const remoteErrorConstructor = RemoteLoadError

assertLegacyTrustedPluginContext(pluginContext)
const legacyPluginContext: LegacyTrustedPluginContext = pluginContext
legacyPluginContext.project.currentDocument?.getHistory()

// @ts-expect-error the side-effect-free instance entry must not expose the legacy singleton facade
const legacyEngine = import('@easy-editor/core/instance').then(module => module.defaultEngine)

void lifecycleState
void pluginManager
void pluginSnapshot
void hasEngineConstructor
void prepared
void validator
void transformStage
void materialSource
void remoteErrorConstructor
void legacyPluginContext
void legacyEngine
void legacyCreateEngine
