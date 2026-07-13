import type { MaterialRegistry } from './material-registry'

const teardownReleases = new WeakMap<MaterialRegistry, (componentName: string) => void>()

export function installMaterialRegistryTeardown(
  registry: MaterialRegistry,
  release: (componentName: string) => void,
): void {
  teardownReleases.set(registry, release)
}

/** Internal, notification-free usage release used only while disposing a Project. */
export function releaseMaterialRegistryUsageDuringTeardown(registry: MaterialRegistry, componentName: string): void {
  teardownReleases.get(registry)?.(componentName)
}
