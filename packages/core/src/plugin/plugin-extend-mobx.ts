import { action, computed, observable } from 'mobx'

export enum MobxExtendType {
  OBSERVABLE = 'observable',
  OBSERVABLE_REF = 'observable.ref',
  OBSERVABLE_SHALLOW = 'observable.shallow',
  COMPUTED = 'computed',
  ACTION = 'action',
}

export const MOBX_EXTEND_SYMBOL = Symbol('mobx-extend')

export interface BaseMobxConfig {
  type: MobxExtendType
}

export interface ObservableConfig<T = any> extends BaseMobxConfig {
  type: MobxExtendType.OBSERVABLE | MobxExtendType.OBSERVABLE_REF | MobxExtendType.OBSERVABLE_SHALLOW
  initialValue?: T
  getter?: (this: any) => T
  setter?: (this: any, value: T) => void
}

export interface ComputedConfig<T = any> extends BaseMobxConfig {
  type: MobxExtendType.COMPUTED
  getter: (this: any) => T
  setter?: (this: any, value: T) => void
}

export interface ActionConfig extends BaseMobxConfig {
  type: MobxExtendType.ACTION
  method: (this: any, ...args: any[]) => any
  name?: string
}

export type MobxConfig = ObservableConfig | ComputedConfig | ActionConfig

export interface MobxExtendDescriptor {
  [MOBX_EXTEND_SYMBOL]: true
  config: MobxConfig
}

export const isMobxExtendProperty = (value: any): value is MobxExtendDescriptor => {
  return value && typeof value === 'object' && value[MOBX_EXTEND_SYMBOL] === true
}

const createMobxDescriptor = <T extends MobxConfig>(config: T): MobxExtendDescriptor => ({
  [MOBX_EXTEND_SYMBOL]: true,
  config,
})

/* ------------------------------- Observable ------------------------------- */
/**
 * 创建 observable 属性
 */
const observableProperty = <T = any>(initialValue?: T) => {
  return createMobxDescriptor<ObservableConfig<T>>({
    type: MobxExtendType.OBSERVABLE,
    initialValue,
  })
}

/**
 * 创建 observable.ref 属性（浅观察）
 */
const observableRef = <T = any>(initialValue?: T) => {
  return createMobxDescriptor<ObservableConfig<T>>({
    type: MobxExtendType.OBSERVABLE_REF,
    initialValue,
  })
}

/**
 * 创建 observable.shallow 属性（浅观察集合）
 */
const observableShallow = <T = any>(initialValue?: T) => {
  return createMobxDescriptor<ObservableConfig<T>>({
    type: MobxExtendType.OBSERVABLE_SHALLOW,
    initialValue,
  })
}

/**
 * 创建带 getter/setter 的 observable 属性
 */
const observableGetterSetter = <T = any>(
  getter: (this: any) => T,
  setter: (this: any, value: T) => void,
  initialValue?: T,
  shallow = false,
) => {
  return createMobxDescriptor<ObservableConfig<T>>({
    type: shallow ? MobxExtendType.OBSERVABLE_REF : MobxExtendType.OBSERVABLE,
    initialValue,
    getter,
    setter,
  })
}

/* -------------------------------- Computed -------------------------------- */
/**
 * 创建 computed 属性
 */
const computedProperty = <T = any>(config: Omit<ComputedConfig<T>, 'type'>) => {
  return createMobxDescriptor<ComputedConfig<T>>({
    type: MobxExtendType.COMPUTED,
    ...config,
  })
}

/**
 * 创建简单的 computed getter
 */
const computedGetter = <T = any>(getter: (this: any) => T) => {
  return computedProperty({ getter })
}

/**
 * 创建带 setter 的 computed 属性
 */
const computedGetterSetter = <T = any>(getter: (this: any) => T, setter: (this: any, value: T) => void) => {
  return computedProperty({ getter, setter })
}

/* ------------------------------- Action ------------------------------- */
/**
 * 创建 action 方法
 */
const actionMethod = (method: (this: any, ...args: any[]) => any, name?: string) => {
  return createMobxDescriptor<ActionConfig>({
    type: MobxExtendType.ACTION,
    method,
    name,
  })
}

/* ------------------------------- Handler ------------------------------- */
/**
 * 处理 Observable 属性
 */
const handleObservableProperty = (prototype: any, propertyName: string, config: ObservableConfig) => {
  const { type, initialValue, getter, setter } = config

  // 选择合适的 observable 装饰器
  let observableDecorator: any
  switch (type) {
    case MobxExtendType.OBSERVABLE_REF:
      observableDecorator = observable.ref
      break
    case MobxExtendType.OBSERVABLE_SHALLOW:
      observableDecorator = observable.shallow
      break
    default:
      observableDecorator = observable
  }

  if (getter || setter) {
    // 带 getter/setter 的 observable 属性
    const privatePropertyName = `_${propertyName}`

    const descriptor: PropertyDescriptor = {
      get:
        getter ||
        function (this: any) {
          // 懒初始化
          if (!(privatePropertyName in this)) {
            this[privatePropertyName] = initialValue
            observableDecorator(this, privatePropertyName)
          }
          return this[privatePropertyName]
        },
      enumerable: true,
      configurable: true,
    }

    if (setter) {
      descriptor.set = setter
    } else {
      descriptor.set = function (this: any, value: any) {
        if (!(privatePropertyName in this)) {
          observableDecorator(this, privatePropertyName)
        }
        this[privatePropertyName] = value
      }
    }

    Object.defineProperty(prototype, propertyName, descriptor)
  } else {
    // 简单的 observable 属性 - 懒初始化
    const privatePropertyName = `__${propertyName}`

    Object.defineProperty(prototype, propertyName, {
      get: function (this: any) {
        // 懒初始化
        if (!(privatePropertyName in this)) {
          this[privatePropertyName] = initialValue
          observableDecorator(this, privatePropertyName)
        }
        return this[privatePropertyName]
      },
      set: function (this: any, value: any) {
        if (!(privatePropertyName in this)) {
          observableDecorator(this, privatePropertyName)
        }
        this[privatePropertyName] = value
      },
      enumerable: true,
      configurable: true,
    })
  }
}

/**
 * 处理 Computed 属性
 */
const handleComputedProperty = (prototype: any, propertyName: string, config: ComputedConfig) => {
  const { getter, setter } = config

  const descriptor: PropertyDescriptor = {
    get() {
      return computed(() => getter.call(this)).get()
    },
    enumerable: true,
    configurable: true,
  }

  if (setter) {
    descriptor.set = function (this: any, value: any) {
      setter.call(this, value)
    }
  }

  Object.defineProperty(prototype, propertyName, descriptor)
}

/**
 * 处理 Action 方法
 */
const handleActionMethod = (prototype: any, propertyName: string, config: ActionConfig) => {
  const { method, name } = config
  const actionName = name || propertyName

  Object.defineProperty(prototype, propertyName, {
    value: action(actionName, method),
    writable: true,
    enumerable: true,
    configurable: true,
  })
}

/**
 * 为类原型添加 Mobx 扩展属性
 */
export const addMobxExtendProperty = (prototype: any, propertyName: string, config: MobxConfig) => {
  switch (config.type) {
    case MobxExtendType.OBSERVABLE:
    case MobxExtendType.OBSERVABLE_REF:
    case MobxExtendType.OBSERVABLE_SHALLOW:
      handleObservableProperty(prototype, propertyName, config as ObservableConfig)
      break
    case MobxExtendType.COMPUTED:
      handleComputedProperty(prototype, propertyName, config as ComputedConfig)
      break
    case MobxExtendType.ACTION:
      handleActionMethod(prototype, propertyName, config as ActionConfig)
      break
    default:
      console.warn(`Unknown Mobx extend type: ${(config as any).type}`)
  }
}

export const mobxExtendObservable = observableProperty
export const mobxExtendObservableRef = observableRef
export const mobxExtendObservableShallow = observableShallow
export const mobxExtendComputed = computedProperty
export const mobxExtendComputedGetter = computedGetter
export const mobxExtendComputedGetterSetter = computedGetterSetter
export const mobxExtendAction = actionMethod
