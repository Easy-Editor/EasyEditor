import {
  createDashboardInvocationActivity,
  createDashboardMutationQuiescenceGate,
  createHumanActivityLease,
  installHumanActivityTracking,
} from '../../editor/agent/activity/index.mjs'
import { createDashboardSameOriginMaterialGcClient } from '../../editor/agent/capabilities/promotion/material-gc-client.mjs'
import { createDashboardMaterialGcCrossTabCoordinator } from '../../editor/agent/capabilities/promotion/material-gc-cross-tab-coordinator.mjs'
import {
  createDashboardMaterialGcReplicaState,
  resolveDashboardMaterialGcEnabled,
} from '../../editor/agent/capabilities/promotion/material-gc-replica-state.mjs'
import { createDashboardMaterialGcRuntime } from '../../editor/agent/capabilities/promotion/material-gc-runtime.mjs'

export { resolveDashboardMaterialGcEnabled }

export const createDashboardPreviewMaterialGcComposition = options => {
  if (options?.enabled !== true) return null

  const environment = options.environment
  const persistence = options.persistence
  const mutationGate = createDashboardMutationQuiescenceGate({ inputTarget: environment.inputTarget })
  const coordinator = createDashboardMaterialGcCrossTabCoordinator({
    enabled: true,
    lockManager: environment.lockManager,
  })
  const humanActivity = createHumanActivityLease()
  const invocationActivity = createDashboardInvocationActivity()
  let releaseHumanActivityTracking = null
  let runtime = null

  try {
    releaseHumanActivityTracking = installHumanActivityTracking({
      lease: humanActivity,
      target: environment.inputTarget,
    })
    const client = createDashboardSameOriginMaterialGcClient({ fetchImpl: environment.fetchImpl })
    const replicaState = createDashboardMaterialGcReplicaState({
      storage: environment.storage,
      crypto: environment.crypto,
      coordinator,
    })
    runtime = createDashboardMaterialGcRuntime({
      enabled: true,
      crypto: environment.crypto,
      client,
      replicaState,
      coordinator,
      persistence,
      humanActivity,
      invocationActivity,
      mutationGate,
      onError: options.onError,
    })
  } catch (error) {
    releaseHumanActivityTracking?.()
    humanActivity.dispose()
    invocationActivity.dispose()
    mutationGate.dispose()
    void coordinator.dispose()
    throw error
  }

  let disposed = false
  return Object.freeze({
    enabled: true,
    withMaterialAdmission: runtime.withMaterialAdmission.bind(runtime),
    dispose() {
      if (disposed) return false
      disposed = true
      runtime.dispose()
      releaseHumanActivityTracking?.()
      releaseHumanActivityTracking = null
      humanActivity.dispose()
      invocationActivity.dispose()
      mutationGate.dispose()
      return true
    },
  })
}
