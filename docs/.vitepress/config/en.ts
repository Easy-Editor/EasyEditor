import { type DefaultTheme, defineConfig } from 'vitepress'
import { version } from '../../../packages/core/package.json'

const description = 'Plugin-based cross-framework low-code engine for building visual application platforms'

// Getting Started Guides
const GettingStartedGuides: DefaultTheme.NavItemWithLink[] = [
  { text: 'Why EasyEditor?', link: '/en/guide/why' },
  { text: 'Getting Started', link: '/en/guide/getting-started' },
  { text: 'Core Concepts', link: '/en/guide/core-concepts' },
]

// Extension Guides
const ExtensionGuides: DefaultTheme.NavItemWithLink[] = [
  { text: 'Plugin Extension', link: '/en/guide/extension/plugin' },
  { text: 'Material Extension', link: '/en/guide/extension/material' },
  { text: 'Setter Extension', link: '/en/guide/extension/setter' },
]

// Renderer Guides
const RendererGuides: DefaultTheme.NavItemWithLink[] = [
  { text: 'Overview', link: '/en/guide/renderer/' },
  { text: 'Using Design-time Renderer', link: '/en/guide/renderer/editor' },
  { text: 'Using Runtime Renderer', link: '/en/guide/renderer/runtime' },
  { text: 'Renderer Customization', link: '/en/guide/renderer/custom' },
]

// Scenario Guides
const ScenarioGuides: DefaultTheme.SidebarItem[] = [
  {
    text: 'Dashboard Design',
    collapsed: true,
    items: [
      { text: 'Introduction', link: '/en/guide/scenarios/dashboard/' },
      { text: 'Getting Started', link: '/en/guide/scenarios/dashboard/getting-started' },
    ],
  },
  {
    text: 'Form Design',
    collapsed: true,
    items: [
      { text: 'Introduction', link: '/en/guide/scenarios/form/' },
      { text: 'Getting Started', link: '/en/guide/scenarios/form/getting-started' },
    ],
  },
]

// Design
const Designs: DefaultTheme.NavItemWithLink[] = [
  { text: 'Architecture Overview', link: '/en/design/overview' },
  { text: 'Protocol Stack', link: '/en/design/specs' },
  { text: 'Editor Module', link: '/en/design/editor' },
  { text: 'Renderer Module', link: '/en/design/renderer' },
  { text: 'Plugin System', link: '/en/design/plugin' },
  { text: 'Setter Module', link: '/en/design/setter' },
]

// API References
const References: DefaultTheme.SidebarItem[] = [
  { text: 'Overview', link: '/en/reference/overview' },
  {
    text: 'Core',
    items: [{ text: 'Editor', link: '/en/reference/core' }],
  },
  {
    text: 'Renderer',
    items: [{ text: 'Renderer', link: '/en/reference/renderer' }],
  },
  {
    text: 'Plugin',
    items: [{ text: 'Plugin', link: '/en/reference/plugin' }],
  },
]

const Resources: DefaultTheme.NavItemWithLink[] = [
  { text: 'EasyDashboard', link: 'https://github.com/Easy-Editor/EasyDashboard', target: '_blank' },
]

const SidebarGuide: DefaultTheme.SidebarItem[] = [
  {
    text: 'Getting Started',
    items: GettingStartedGuides,
  },
  {
    text: 'Extensions',
    items: ExtensionGuides,
  },
  {
    text: 'Renderers',
    items: RendererGuides,
  },
  {
    text: 'Scenarios',
    items: ScenarioGuides,
  },
  {
    text: 'Design Principles',
    link: '/en/design/',
  },
  {
    text: 'API Reference',
    link: '/en/reference/',
  },
]

const Nav: DefaultTheme.NavItem[] = [
  {
    text: 'Guide',
    items: [
      {
        text: 'Getting Started',
        items: GettingStartedGuides.slice(0, 2),
      },
      {
        text: 'Scenarios',
        items: [
          { text: 'Dashboard Design', link: '/en/guide/scenarios/dashboard/' },
          { text: 'Form Design', link: '/en/guide/scenarios/form/' },
        ],
      },
    ],
    activeMatch: '^/en/guide/',
  },
  {
    text: 'Design',
    items: Designs,
  },
  {
    text: 'Reference',
    items: [
      { text: 'Overview', link: '/en/reference/overview/' },
      { text: 'Core', link: '/en/reference/core/' },
      { text: 'Plugin', link: '/en/reference/plugin/' },
      { text: 'Renderer', link: '/en/reference/renderer/' },
    ],
    activeMatch: '^/en/reference/',
  },
  {
    text: 'Resources',
    items: [...Resources],
  },
  {
    text: `v${version}`,
    items: [
      {
        text: 'Release Notes',
        link: 'https://github.com/Easy-Editor/EasyEditor/releases',
      },
      {
        text: 'Report',
        link: 'https://github.com/Easy-Editor/EasyEditor/issues',
      },
      {
        component: 'RainbowAnimationSwitcher',
        props: {
          text: 'Rainbow Animation',
        },
      },
    ],
  },
]

const Sidebar: DefaultTheme.Sidebar = {
  '/en/guide/': SidebarGuide,
  '/en/design/': Designs,
  '/en/reference/': References,
}

export const en = defineConfig({
  lang: 'en',
  description,

  themeConfig: {
    nav: Nav,
    sidebar: Sidebar,
  },
})
