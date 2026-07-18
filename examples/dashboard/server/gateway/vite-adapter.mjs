export const MODEL_GATEWAY_VITE_PLUGIN_NAME = 'easy-editor-agent-model-gateway'

export const createModelGatewayVitePlugin = middleware => ({
  name: MODEL_GATEWAY_VITE_PLUGIN_NAME,
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      void middleware(request, response, next)
    })
  },
})
