import type { ExpressionEvaluator, RendererProps } from '@easy-editor/renderer-core'

declare const evaluator: ExpressionEvaluator
declare const baseProps: Omit<RendererProps, 'expressionEvaluator'>

const deniedRendererProps: RendererProps = { ...baseProps, expressionEvaluator: evaluator }
const explicitlyMissingRendererProps: RendererProps = { ...baseProps, expressionEvaluator: undefined }
const legacyRendererProps: RendererProps = { ...baseProps }

void deniedRendererProps
void explicitlyMissingRendererProps
void legacyRendererProps
