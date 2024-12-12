import { createContext, use } from 'react'

export interface RendererContext {
  [extra: string]: any
}

export const RendererContext = createContext<RendererContext>({} as RendererContext)

export const useRendererContext = () => {
  try {
    return use(RendererContext)
  } catch (error) {
    console.warn('useRendererContext must be used within a RendererContextProvider')
  }
  return {} as RendererContext
}
