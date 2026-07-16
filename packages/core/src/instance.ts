/**
 * Finite, host-owned EasyEditor framework contract.
 *
 * Keep this entry explicit. Wildcard exports turn implementation details into
 * accidental semver commitments and weaken the engine ownership boundary.
 */

export { createEngine } from './engine/engine-instance'
export type {
  EngineInstance,
  EngineInstanceOptions,
  EngineLifecycleState,
  RemoteAccessRequest,
  RemoteAdapter,
} from './engine/engine-instance'

export type { Config, ConfigOptions } from './config'

export {
  AsyncTransactionNotSupportedError,
  CommandValidationError,
  DocumentMutationVersionConflictError,
  EDITOR_COMMAND_TYPES,
  InvalidDocumentMutationVersionError,
  TransactionCommittedError,
  TransactionRollbackIncompleteError,
  isEditorCommandType,
  validateCommands,
} from './commands'
export type {
  BoundTransactionOptions,
  CommandManager,
  CommandResult,
  CommandValidationIssue,
  EditorCommand,
  EditorCommandMap,
  EditorCommandType,
  InsertAfterCommand,
  InsertBeforeCommand,
  InsertNodeCommand,
  MoveNodeCommand,
  RemoveNodeCommand,
  ReplaceNodeCommand,
  TransactionManager,
  TransactionPostcondition,
  TransactionPrecondition,
  TransactionResult,
  UnwrapNodeCommand,
  UpdatePropsCommand,
  WrapNodeCommand,
} from './commands'

export {
  CURRENT_PROJECT_SCHEMA_VERSION,
  LEGACY_PROJECT_SCHEMA_VERSION,
  SchemaValidationError,
  SchemaValidator,
  validateProjectSchema,
} from './schema'
export type {
  SchemaMigrationRecord,
  SchemaNormalizationRecord,
  SchemaPreparationReport,
  SchemaPreparationResult,
  SchemaValidationIssue,
} from './schema'

export { PolicyViolation, assertTrustCapability, resolveTrustPolicy } from './trust'
export type {
  ExecutableValueLocation,
  PolicyViolationOptions,
  TrustCapability,
  TrustPolicy,
  TrustPolicyPreset,
} from './trust'

export type {
  LegacyTrustedPluginContext,
  Plugin,
  PluginClipboardCapability,
  PluginComponentMetaCapability,
  PluginConfigCapability,
  PluginContext,
  PluginCreator,
  PluginEventCapability,
  PluginExtend,
  PluginHotkeyCapability,
  PluginLoggerCapability,
  PluginManager,
  PluginMaterialsCapability,
  PluginMeta,
  PluginProjectCapability,
  PluginRegisterOptions,
  PluginRegistry,
  PluginRuntimeSnapshot,
  PluginSettersCapability,
  RestrictedPluginContextCapabilities,
} from './plugin'
export { assertLegacyTrustedPluginContext } from './plugin'

export { MaterialSource, MaterialStatus, RegistryEventType } from './materials'
export type {
  ComponentMeta,
  IMaterialRegistry,
  MaterialEntry,
  MaterialRegistryEntrySnapshot,
  MaterialRegistrySnapshot,
  Materials,
  RegisterOptions,
  RegistryEvent,
  RegistryEventListener,
  UnloadOptions,
} from './materials'

export type { RegisteredSetter, Setter, SetterProps, Setters } from './setters'

export {
  DEFAULT_TIMEOUT,
  LoadingStatus,
  RemoteLoadError,
  RemoteLoadErrorType,
} from './remote'
export type {
  LoadOptions,
  LoadProgress,
  LoadedResource,
  LoadingStateManager,
  MaterialInfo,
  ResourceRegistry,
  ResourceState,
  ResourceType,
  SetterInfo,
  StateChangeListener,
} from './remote'

// Compatibility surface for the current Web/DOM renderer adapters. These are
// readable integration models, not the stable application write authority.
export { DESIGNER_EVENT, DragObjectType, makeEventsHandler } from './designer'
export type {
  CanvasPoint,
  Clipboard,
  Designer,
  DesignerProps,
  DragObject,
  DropLocation,
  NodeInstance,
  OffsetObserver,
  Point,
  Rect,
  SettingField,
  SettingsManager,
} from './designer'

export {
  getClosestNode,
  getConvertedExtraKey,
  insertChild,
  insertChildren,
  isDocument,
  isJSExpression,
  isJSFunction,
  isNode,
  isNodeSchema,
} from './document'
export type {
  CompositeArray,
  CompositeObject,
  CompositeValue,
  Document,
  History,
  JSExpression,
  JSFunction,
  JSONArray,
  JSONObject,
  JSONValue,
  Node,
  NodeChildren,
  PropsMap,
} from './document'

export type { Project, RendererReadyReceipt } from './project'

export { Simulator, isSimulator, isSimulatorRenderer } from './simulator'
export type {
  DesignMode,
  Device,
  DeviceStyleProps,
  SimulatorProps,
  SimulatorRenderer,
  Viewport,
} from './simulator'

export { AssetLevel, AssetLevels, AssetType, EDITOR_EVENT, GLOBAL_EVENT, TRANSFORM_STAGE } from './types'
export type {
  Advanced,
  Asset,
  AssetBundle,
  AssetItem,
  AssetList,
  Callbacks,
  Component,
  ComponentConfigure,
  ComponentInstance,
  ComponentMap,
  ComponentMetadata,
  ComponentType,
  ComponentsMap,
  Configure,
  DataSource,
  DataSourceEngine,
  DataSourceItem,
  DynamicSetter,
  DynamicSetterProps,
  FieldConfig,
  NpmInfo,
  NodeData,
  NodeSchema,
  ProjectSchema,
  RootSchema,
  SetterConfig,
  Snippet,
} from './types'

export {
  createEventBus,
  createLogger,
  isElementNode,
  isRemoteComponent,
  isSetterConfig,
  isTextNode,
} from './utils'
export type { ApiHotkey, Disposable, Event, EventBus, Logger } from './utils'
