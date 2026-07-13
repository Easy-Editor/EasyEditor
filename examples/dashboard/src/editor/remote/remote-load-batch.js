const toError = error => (error instanceof Error ? error : new Error(String(error)))

/**
 * Preserve the package identity beside every rejection. Callers may choose to
 * continue with partial results or promote failures to an AggregateError.
 */
export const settleRemotePackageLoads = async (configs, load) => {
  const results = await Promise.allSettled(configs.map(config => Promise.resolve().then(() => load(config))))
  const failures = []
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') continue
    const config = configs[index]
    failures.push({
      package: config.package,
      version: config.version || 'latest',
      globalName: config.globalName,
      error: toError(result.reason),
    })
  }
  return {
    total: results.length,
    succeeded: results.length - failures.length,
    failed: failures.length,
    failures,
  }
}
