import { createDashboardOnlineArtifactCoreAdapter } from '../artifact/core-adapter.mjs'

export const createDashboardLocalMaterialPromotionCoreAdapter = options => {
  const delegate = createDashboardOnlineArtifactCoreAdapter(options)
  return Object.freeze({
    prepareSwitch: input => delegate.prepareRevise(input),
    switchRef: input => delegate.reviseOnline(input),
    restoreOnline: input => delegate.reviseOnline(input),
    captureProject: () => delegate.captureProject(),
  })
}
