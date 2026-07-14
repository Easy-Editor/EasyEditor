import type { SettingTopEntry } from './setting-top-entry'

const disposerRegistrations = new WeakMap<SettingTopEntry, (dispose: () => void) => void>()

/** Package-private disposer registration seam; not part of the framework entry. */
export function installSettingTopEntryDisposerBoundary(
  entry: SettingTopEntry,
  register: (dispose: () => void) => void,
): void {
  if (disposerRegistrations.has(entry)) {
    throw new Error('SettingTopEntry disposer boundary is already installed')
  }
  disposerRegistrations.set(entry, register)
}

/** Test-only kernel hook for deterministic cleanup-failure regressions. */
export function registerSettingTopEntryDisposer(entry: SettingTopEntry, dispose: () => void): void {
  const register = disposerRegistrations.get(entry)
  if (!register) throw new Error('SettingTopEntry disposer boundary is not installed')
  register(dispose)
}
