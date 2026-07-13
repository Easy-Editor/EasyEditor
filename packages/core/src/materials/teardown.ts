import type { Materials } from './materials'

const teardownReleases = new WeakMap<Materials, (componentName: string) => void>()

export function installMaterialsTeardown(materials: Materials, release: (componentName: string) => void): void {
  teardownReleases.set(materials, release)
}

/** Internal seam; deliberately not re-exported from the package surface. */
export function releaseMaterialUsageDuringTeardown(materials: Materials, componentName: string): void {
  teardownReleases.get(materials)?.(componentName)
}
