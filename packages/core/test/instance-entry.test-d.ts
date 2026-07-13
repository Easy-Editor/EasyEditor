import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  EngineInstance,
  type EngineInstanceOptions,
  type EngineLifecycleState,
  MaterialSource,
  type RemoteAccessRequest,
  type RemoteAdapter,
  RemoteLoadError,
  SchemaValidator,
  TRANSFORM_STAGE,
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
const lifecycleState: EngineLifecycleState = engine.lifecycleState
const directEngine = new EngineInstance(options)
const currentVersion: '1.0.0' = CURRENT_PROJECT_SCHEMA_VERSION
const prepared = validateProjectSchema(
  { componentsTree: [], version: currentVersion },
  resolveTrustPolicy('legacyTrusted'),
)
const validator = new SchemaValidator(resolveTrustPolicy('legacyTrusted'))
const transformStage = TRANSFORM_STAGE.RENDER
const materialSource = MaterialSource.REMOTE
const remoteErrorConstructor = RemoteLoadError

// @ts-expect-error the side-effect-free instance entry must not expose the legacy singleton facade
const legacyEngine = import('@easy-editor/core/instance').then(module => module.defaultEngine)

void lifecycleState
void directEngine
void prepared
void validator
void transformStage
void materialSource
void remoteErrorConstructor
void legacyEngine
