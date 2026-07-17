export const DASHBOARD_SAFE_DATA_FEATURE_FLAG_ENV = 'VITE_DASHBOARD_AGENT_DATA'

export const resolveDashboardSafeDataFeatureFlag = (source = {}) => {
  const value = source?.[DASHBOARD_SAFE_DATA_FEATURE_FLAG_ENV]
  return value === true || value === 'true' || value === '1'
}
