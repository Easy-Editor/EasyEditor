import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const spikeDirectory = path.dirname(fileURLToPath(import.meta.url))
const dashboardDirectory = path.resolve(spikeDirectory, '../../examples/dashboard')
const dashboardSourceDirectory = path.resolve(dashboardDirectory, 'src')
const easyMaterialsDirectory = path.resolve(spikeDirectory, '../../../EasyMaterials')
const dashboardAgentHostDist = path.resolve(spikeDirectory, '../../packages/dashboard-agent-host/dist/index.js')
const requireFromDashboard = createRequire(path.resolve(dashboardDirectory, 'package.json'))
const requireFromEasyMaterials = createRequire(
  path.resolve(easyMaterialsDirectory, 'packages/dashboard/chart/bar-chart/package.json'),
)
const react = requireFromDashboard('@vitejs/plugin-react').default
const tailwindcss = requireFromDashboard('@tailwindcss/vite').default
const dashboardDependencyDirectory = (packageName: string) =>
  path.dirname(requireFromDashboard.resolve(`${packageName}/package.json`))
const easyMaterialsDependencyDirectory = (packageName: string) =>
  path.dirname(requireFromEasyMaterials.resolve(`${packageName}/package.json`))
const dashboardMaterialBundle = (relativePackageDirectory: string) =>
  path.resolve(easyMaterialsDirectory, `packages/dashboard/${relativePackageDirectory}/dist/index.min.esm.js`)

export default {
  root: path.resolve(spikeDirectory, 'harness'),
  publicDir: path.resolve(dashboardDirectory, 'public'),
  envDir: dashboardDirectory,
  define: {
    __EASY_EDITOR_AGENT_RUNTIME_E2E__: JSON.stringify(true),
  },
  plugins: [
    react({
      babel: {
        exclude: 'node_modules/**',
        babelrc: false,
        presets: [
          [
            '@babel/preset-typescript',
            {
              allowDeclareFields: true,
            },
          ],
        ],
        plugins: [
          [
            '@babel/plugin-proposal-decorators',
            {
              version: '2023-11',
            },
          ],
        ],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: [
      {
        find: '@/editor/agent/executor-materials',
        replacement: path.resolve(spikeDirectory, 'harness/executor-materials.ts'),
      },
      {
        find: '@easy-editor/materials-dashboard-text',
        replacement: dashboardMaterialBundle('basic/text'),
      },
      {
        find: '@easy-editor/materials-dashboard-bar-chart',
        replacement: dashboardMaterialBundle('chart/bar-chart'),
      },
      {
        find: '@easy-editor/materials-dashboard-line-chart',
        replacement: dashboardMaterialBundle('chart/line-chart'),
      },
      {
        find: '@easy-editor/materials-dashboard-pie-chart',
        replacement: dashboardMaterialBundle('chart/pie-chart'),
      },
      {
        find: '@easy-editor/materials-dashboard-number-flip',
        replacement: dashboardMaterialBundle('display/number-flip'),
      },
      {
        find: '@easy-editor/materials-dashboard-progress',
        replacement: dashboardMaterialBundle('display/progress'),
      },
      {
        find: '@easy-editor/materials-dashboard-scroll-list',
        replacement: dashboardMaterialBundle('display/scroll-list'),
      },
      {
        find: '@easy-editor/materials-dashboard-geo-map',
        replacement: dashboardMaterialBundle('map/geo-map'),
      },
      {
        find: '@easy-editor/dashboard-agent-host',
        replacement: dashboardAgentHostDist,
      },
      {
        find: '@easy-editor/core/instance',
        replacement: requireFromDashboard.resolve('@easy-editor/core/instance'),
      },
      {
        find: '@/editor/agent/runtime-e2e/index.mjs',
        replacement: path.resolve(dashboardSourceDirectory, 'editor/agent/runtime-e2e/index.mjs'),
      },
      { find: '/src', replacement: dashboardSourceDirectory },
      { find: '@', replacement: dashboardSourceDirectory },
      { find: 'echarts', replacement: easyMaterialsDependencyDirectory('echarts') },
      { find: 'react-dom', replacement: dashboardDependencyDirectory('react-dom') },
      { find: 'react', replacement: dashboardDependencyDirectory('react') },
    ],
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: path.resolve(spikeDirectory, '.browser-dist'),
    emptyOutDir: true,
    target: 'esnext',
    sourcemap: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(spikeDirectory, 'harness/index.html'),
      output: {
        inlineDynamicImports: true,
      },
    },
  },
}
