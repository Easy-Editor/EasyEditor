import {
  assertExactRecord,
  ownDataValue,
  requireNonEmptyString,
  requireSchemaVersion,
} from '../persistence/contract.mjs'
import { validateLockedArtifactDependency } from './artifact-contracts.mjs'

export const ONLINE_COMPONENT_DEPENDENCY_RESOLVE_ENDPOINT = '/api/online-components/dependencies/resolve'

const normalizeRequest = value => {
  assertExactRecord(value, ['package', 'range'], [], 'OnlineComponentDependencyResolver.request')
  return Object.freeze({
    package: requireNonEmptyString(
      ownDataValue(value, 'package', 'OnlineComponentDependencyResolver.request'),
      'OnlineComponentDependencyResolver.request.package',
    ),
    range: requireNonEmptyString(
      ownDataValue(value, 'range', 'OnlineComponentDependencyResolver.request'),
      'OnlineComponentDependencyResolver.request.range',
    ),
  })
}

export const createDashboardOnlineComponentDependencyResolver = ({ fetchImpl = globalThis.fetch } = {}) => {
  if (typeof fetchImpl !== 'function') throw new TypeError('online component dependency resolver requires fetch')
  return Object.freeze({
    async resolve(value) {
      const request = normalizeRequest(value)
      const response = await fetchImpl(ONLINE_COMPONENT_DEPENDENCY_RESOLVE_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!response || response.ok !== true || typeof response.json !== 'function') {
        throw new Error(`Online dependency resolution failed with HTTP ${response?.status ?? 'unknown'}`)
      }
      const payload = await response.json()
      assertExactRecord(payload, ['schemaVersion', 'dependency'], [], 'OnlineComponentDependencyResolver.response')
      requireSchemaVersion(
        ownDataValue(payload, 'schemaVersion', 'OnlineComponentDependencyResolver.response'),
        'OnlineComponentDependencyResolver.response.schemaVersion',
      )
      const dependency = validateLockedArtifactDependency(
        ownDataValue(payload, 'dependency', 'OnlineComponentDependencyResolver.response'),
      )
      if (dependency.package !== request.package || dependency.range !== request.range) {
        throw new Error('Online dependency resolver returned a different package or range')
      }
      return dependency
    },
  })
}
