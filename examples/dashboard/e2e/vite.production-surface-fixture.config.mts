import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const dashboardDirectory = fileURLToPath(new URL('..', import.meta.url))
const fixtureOutputDirectory = fileURLToPath(
  new URL('../node_modules/.tmp/dashboard-production-surface-e2e', import.meta.url),
)

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./fixtures/generated-material-host-production-seed.mjs', import.meta.url)),
      fileName: 'generated-material-host-production-seed',
      formats: ['es'],
    },
    minify: false,
    outDir: fixtureOutputDirectory,
    target: 'esnext',
  },
  root: dashboardDirectory,
})
