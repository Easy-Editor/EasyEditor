import type { Config } from '../config'
import type { Clipboard } from '../designer/clipboard'
import type { Materials } from '../materials/materials'
import type { Project } from '../project/project'
import type { Setters } from '../setters/setters'
import type { Event } from '../utils/event'
import type { Hotkey } from '../utils/hotkey'
import type { Logger } from '../utils/logger'
import type {
  PluginClipboardCapability,
  PluginConfigCapability,
  PluginEventCapability,
  PluginHotkeyCapability,
  PluginLoggerCapability,
  PluginMaterialsCapability,
  PluginProjectCapability,
  PluginSettersCapability,
  RestrictedPluginContextCapabilities,
} from './plugin-context'

interface FiniteCapabilitySpec<T extends object> {
  readonly methods?: readonly (keyof T)[]
  readonly properties?: readonly (keyof T)[]
}

interface RestrictedPluginContextCapabilitySources {
  readonly clipboard: Clipboard
  readonly config: Config
  readonly event: Event
  readonly hotkey: Hotkey
  readonly logger: Logger
  readonly materials: Materials
  readonly project: Project
  readonly setters: Setters
}

/**
 * Build a null-prototype facade that has no service back-references of its own.
 * The PluginContext lifecycle binder is applied afterwards and owns revocation.
 */
const createFiniteCapabilityFacade = <TSource extends object, TCapability extends object>(
  source: TSource,
  spec: FiniteCapabilitySpec<TSource>,
): TCapability => {
  const facade = Object.create(null) as Record<PropertyKey, unknown>
  for (const property of spec.properties || []) {
    Object.defineProperty(facade, property, {
      enumerable: true,
      get: () => Reflect.get(source, property, source),
    })
  }
  for (const property of spec.methods || []) {
    const method = Reflect.get(source, property, source)
    if (typeof method !== 'function') {
      throw new TypeError(`Restricted plugin capability method ${String(property)} is not callable`)
    }
    Object.defineProperty(facade, property, {
      enumerable: true,
      value: (...args: unknown[]) => {
        const result = Reflect.apply(method, source, args)
        return result === source ? facade : result
      },
    })
  }
  return Object.freeze(facade) as TCapability
}

/**
 * Root capabilities for an agentRestricted same-realm plugin.
 *
 * These facades define the supported plugin API and cut service graph back
 * references (`editor`, `designer`, `eventBus`, registries, teardown methods).
 * They are an authority-minimization boundary, not realm isolation.
 */
export const createRestrictedPluginContextCapabilities = (
  sources: RestrictedPluginContextCapabilitySources,
): RestrictedPluginContextCapabilities => ({
  clipboard: createFiniteCapabilityFacade<Clipboard, PluginClipboardCapability>(sources.clipboard, {
    methods: ['initCopyPaster', 'injectCopyPaster', 'isCopyPasteEvent', 'setData', 'waitPasteData'],
  }),
  config: createFiniteCapabilityFacade<Config, PluginConfigCapability>(sources.config, {
    methods: ['get', 'has', 'onGot', 'onceGot', 'set', 'setConfig'],
  }),
  event: createFiniteCapabilityFacade<Event, PluginEventCapability>(sources.event, {
    methods: ['emit', 'off', 'on', 'prependListener'],
  }),
  hotkey: createFiniteCapabilityFacade<Hotkey, PluginHotkeyCapability>(sources.hotkey, {
    methods: ['acquireBinding', 'activate', 'bind', 'unbind'],
    properties: ['callBacks'],
  }),
  logger: createFiniteCapabilityFacade<Logger, PluginLoggerCapability>(sources.logger, {
    methods: ['debug', 'error', 'info', 'log', 'warn'],
  }),
  materials: createFiniteCapabilityFacade<Materials, PluginMaterialsCapability>(sources.materials, {
    methods: [
      'buildComponentMetasMap',
      'canUnload',
      'createComponentMeta',
      'decrementUsage',
      'getComponentMeta',
      'getComponentMetasMap',
      'getComponentSnippets',
      'getUsageCount',
      'incrementUsage',
      'isComponentMeta',
      'refreshComponentMetasMap',
      'removeComponentMeta',
    ],
    properties: ['componentMetasMap', 'componentsMap', 'version'],
  }),
  project: createFiniteCapabilityFacade<Project, PluginProjectCapability>(sources.project, {
    methods: ['allowsDirectModelMutation', 'export', 'get'],
    properties: ['config'],
  }),
  setters: createFiniteCapabilityFacade<Setters, PluginSettersCapability>(sources.setters, {
    methods: ['createSetterContent', 'getSetter', 'getSettersMap', 'registerSetter'],
    properties: ['settersMap'],
  }),
})
