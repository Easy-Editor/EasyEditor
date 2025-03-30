import { type DefaultTheme, defineConfig } from 'vitepress'
import { version } from '../../packages/core/package.json'

const title = 'EasyEditor'
const description = 'Plugin-based cross-framework low-code engine for building visual application platforms'

const Guides: DefaultTheme.NavItemWithLink[] = [
  { text: 'Getting Started', link: '/guide/' },
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
        link: 'https://github.com/unocss/unocss/releases',
      },
      {
        text: 'Contributing',
        link: 'https://github.com/unocss/unocss/blob/main/.github/CONTRIBUTING.md',
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
    text: 'Integrations',
    link: '/integrations/',
  },
  {
    text: 'Config',
    link: '/config/',
  },
  {
    text: 'Presets',
    link: '/presets/',
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

export default defineConfig({
  lang: 'zh',
  title,
  titleTemplate: title,
  description,
  outDir: './dist',
  head: [
    ['link', { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
    ['link', { rel: 'alternate icon', href: '/favicon.ico', type: 'image/png', sizes: '16x16' }],
    ['meta', { name: 'author', content: 'JinSo' }],
    [
      'link',
      { rel: 'search', type: 'application/opensearchdescription+xml', href: '/search.xml', title: 'EasyEditor' },
    ],
  ],
  lastUpdated: true,
  cleanUrls: true,

  themeConfig: {
    logo: '/logo-dark.svg',
    search: {
      provider: 'local',
    },

    nav: Nav,
    sidebar: Sidebar,

    socialLinks: [{ icon: 'github', link: 'https://github.com/Easy-Editor/EasyEditor' }],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-PRESENT JinSo',
    },
  },
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh',
    },
    en: {
      label: 'English',
      lang: 'en',
      link: '/en',
    },
  },
})
