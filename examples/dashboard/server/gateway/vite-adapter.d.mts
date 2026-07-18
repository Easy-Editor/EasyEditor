import type { Plugin } from 'vite'

import type { ModelGatewayMiddleware } from './index.mjs'

export const MODEL_GATEWAY_VITE_PLUGIN_NAME: 'easy-editor-agent-model-gateway'

export function createModelGatewayVitePlugin(middleware: ModelGatewayMiddleware): Plugin
