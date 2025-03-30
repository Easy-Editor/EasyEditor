import { type DefaultTheme, defineConfig } from 'vitepress'
import { version } from '../../../packages/core/package.json'

const description = 'Plugin-based cross-framework low-code engine for building visual application platforms'

const Guides: DefaultTheme.NavItemWithLink[] = [
  { text: 'Getting Started', link: '/guide/getting-started' },
  { text: 'Why EasyEditor?', link: '/guide/why' },
]

const Configs: DefaultTheme.NavItemWithLink[] = [{ text: 'Config', link: '/config/' }]

const References: DefaultTheme.NavItemWithLink[] = [
  { text: 'Reference', link: '/reference/' },
  { text: 'Editor', link: '/reference/editor' },
]

const Resources: DefaultTheme.NavItemWithLink[] = [
  { text: 'EasyDashboard', link: 'https://github.com/Easy-Editor/EasyDashboard', target: '_blank' },
]

const Nav: DefaultTheme.NavItem[] = [
  {
    text: 'Guide',
    items: [
      {
        text: 'Guide',
        items: Guides,
      },
    ],
    activeMatch: '^/guide/',
  },
  {
    text: 'Config',
    items: [
      {
        text: 'Config',
        items: Configs,
      },
    ],
    activeMatch: '^/config/',
  },
  {
    text: 'Reference',
    items: [
      {
        text: 'Reference',
        items: References,
      },
    ],
    activeMatch: '^/reference/',
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

const SidebarGuide: DefaultTheme.SidebarItem[] = [
  {
    text: 'Guides',
    items: Guides,
  },
  {
    text: 'Config',
    link: '/config/',
  },
]

const SidebarConfigs: DefaultTheme.SidebarItem[] = [
  {
    text: 'Config',
    collapsed: false,
    items: Configs,
  },
]

const SidebarReferences: DefaultTheme.SidebarItem[] = [
  {
    text: 'Reference',
    collapsed: false,
    items: References,
  },
]

const Sidebar: DefaultTheme.Sidebar = {
  '/guide/': SidebarGuide,
  '/config/': SidebarConfigs,
  '/reference/': SidebarReferences,
}

export const en = defineConfig({
  lang: 'en',
  description,

  themeConfig: {
    nav: Nav,
    sidebar: Sidebar,
  },
})
