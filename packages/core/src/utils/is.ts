export const isObject = (value: any): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object'
}

export const isPlainObject = (value: any): value is any => {
  if (!isObject(value)) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null || Object.getPrototypeOf(proto) === null
}
