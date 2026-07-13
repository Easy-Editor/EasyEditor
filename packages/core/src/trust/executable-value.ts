export interface ExecutableValueLocation {
  path: string
  type: 'Accessor' | 'CircularReference' | 'Function' | 'JSExpression' | 'JSFunction' | 'NonPlainObject'
}

const appendPath = (path: string, key: string | number): string => {
  if (typeof key === 'number') return `${path}[${key}]`
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
}

export const findExecutableValue = (
  value: unknown,
  path = '$',
  visited = new Set<object>(),
): ExecutableValueLocation | null => {
  if (typeof value === 'function') return { path, type: 'Function' }
  if (!value || typeof value !== 'object') return null
  if (visited.has(value)) return { path, type: 'CircularReference' }
  visited.add(value)

  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return { path, type: 'NonPlainObject' }
  }

  const type = Object.getOwnPropertyDescriptor(value, 'type')?.value
  if (type === 'JSExpression' || type === 'JSFunction') {
    return { path, type }
  }

  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    const childPath = appendPath(path, typeof key === 'symbol' ? key.toString() : key)
    if (descriptor.get || descriptor.set) return { path: childPath, type: 'Accessor' }
    const found = findExecutableValue(descriptor.value, childPath, visited)
    if (found) return found
  }
  return null
}
