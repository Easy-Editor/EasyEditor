import { isPlainObject } from '..'

export const cloneDeep = (src: any): any => {
  const type = typeof src

  let data: any
  if (src === null || src === undefined) {
    data = src
  } else if (Array.isArray(src)) {
    data = src.map(item => cloneDeep(item))
  } else if (type === 'object' && isPlainObject(src)) {
    data = {}
    for (const key in src) {
      if (Object.prototype.hasOwnProperty.call(src, key)) {
        data[key] = cloneDeep(src[key])
      }
    }
  } else {
    data = src
  }

  return data
}
