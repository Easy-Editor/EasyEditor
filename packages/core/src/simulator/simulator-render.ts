export interface SimulatorRenderer {
  rerender: () => void

  [key: string]: any
}
