import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { dashboardJsxRuntime } from './jsx-runtime-global.mjs'

/**
 * Builds the compatibility globals required by legacy UMD materials without
 * mutating the browser realm. The runtime adapter owns installation/removal.
 */
export const createDashboardUmdGlobals = (): Readonly<Record<string, unknown>> => ({
  React,
  ReactDOM,
  jsxRuntime: dashboardJsxRuntime,
})
