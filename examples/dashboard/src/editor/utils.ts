export const formatMapFromESModule = <T>(map: Record<string, unknown>) => {
  return Object.keys(map).reduce<Record<string, T>>((result, key) => {
    result[key] = map[key] as T
    return result
  }, {})
}

export const getSystemFonts = async () => {
  try {
    // @ts-ignore
    const availableFonts = await window.queryLocalFonts()
    return Array.from(new Set(availableFonts.map((font: any) => font.family))).map((font: any) => ({
      label: font,
      value: font,
    }))
  } catch {
    console.error('浏览器不支持 queryLocalFonts API')
    return []
  }
}

export const systemFonts = await getSystemFonts()
