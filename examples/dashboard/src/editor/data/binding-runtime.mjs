import { applySafeDataTransform, parseSafeDataBindings } from './contract.mjs'

const isPlainRecord = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

const readOwnDataProperty = (value, key) => {
  if (!isPlainRecord(value)) return undefined
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable === true && 'value' in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolves renderer-owned page data without evaluating host accessors. The
 * descriptor and transform contracts remain the single authority for both
 * built-in materials and generated online materials.
 */
export const resolveDashboardMaterialBindingValue = ({ bindingField, dataBindings, dataSource, fallback }) => {
  if (dataBindings === undefined) return fallback

  try {
    const parsed = parseSafeDataBindings(dataBindings)
    const field = parsed.fields[bindingField]
    if (!field) return fallback
    const page = readOwnDataProperty(dataSource, 'page')
    const sourceValue = readOwnDataProperty(page, field.sourceId)
    if (sourceValue === undefined) return fallback
    return field.transform ? applySafeDataTransform(sourceValue, field.transform) : sourceValue
  } catch {
    return fallback
  }
}
