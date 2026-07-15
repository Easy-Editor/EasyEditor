import { legacyTrustedExpressionEvaluator } from '@easy-editor/renderer-core'

/**
 * The example intentionally executes legacy dashboard schema in the host Realm.
 * Keeping this decision in one side-effect-free module makes both editor and
 * preview composition explicit without importing the engine runtime.
 */
export const dashboardExpressionEvaluator = legacyTrustedExpressionEvaluator
