export const formatMapFromESModule = <T>(map: Record<string, unknown>) => {
  return Object.keys(map).reduce<Record<string, T>>((result, key) => {
    result[key] = map[key] as T
    return result
  }, {})
}
