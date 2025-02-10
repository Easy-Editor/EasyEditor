import { createContext, useContext } from 'react'

export interface RendererContext {
  [extra: string]: any
}

export const RendererContext = createContext<RendererContext>({} as RendererContext)

export const useRendererContext = () => {
  try {
    return useContext(RendererContext)
  } catch (error) {
    console.warn('useRendererContext must be used within a RendererContextProvider')
  }
  return {} as RendererContext
}

export function contextFactory() {
  let context = (window as any).__appContext
  if (!context) {
    context = createContext({})
    ;(window as any).__appContext = context
  }
  return context
}
