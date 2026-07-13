import {
  EngineInstance,
  type EngineInstanceOptions,
  type EngineLifecycleState,
  type RemoteAccessRequest,
  type RemoteAdapter,
  createEngine,
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

// @ts-expect-error the side-effect-free instance entry must not expose the legacy singleton facade
const legacyEngine = import('@easy-editor/core/instance').then(module => module.defaultEngine)

void lifecycleState
void directEngine
void legacyEngine
