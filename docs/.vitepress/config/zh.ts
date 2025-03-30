import { type DefaultTheme, defineConfig } from 'vitepress'
import { version } from '../../../packages/core/package.json'

const description = 'Plugin-based cross-framework low-code engine for building visual application platforms'

const Guides: DefaultTheme.NavItemWithLink[] = [
  { text: '快速开始', link: '/guide/getting-started' },
  { text: '为什么选择 EasyEditor', link: '/guide/why' },
]

const Configs: DefaultTheme.NavItemWithLink[] = [{ text: '配置', link: '/config/' }]

const References: DefaultTheme.NavItemWithLink[] = [
  { text: '参考', link: '/reference/' },
  { text: 'Editor', link: '/reference/editor' },
]

const Resources: DefaultTheme.NavItemWithLink[] = [
  { text: 'EasyDashboard', link: 'https://github.com/Easy-Editor/EasyDashboard', target: '_blank' },
]

const Nav: DefaultTheme.NavItem[] = [
  {
    text: '指南',
    items: [
      {
        text: '指南',
        items: Guides,
      },
    ],
    activeMatch: '^/guide/',
  },
  {
    text: '配置',
    items: [
      {
        text: '配置',
        items: Configs,
      },
    ],
    activeMatch: '^/config/',
  },
  {
    text: '参考',
    items: [
      {
        text: '参考',
        items: References,
      },
    ],
    activeMatch: '^/reference/',
  },
  {
    text: '资源',
    items: [...Resources],
  },
  {
    text: `v${version}`,
    items: [
      {
        text: '发布日志',
        link: 'https://github.com/Easy-Editor/EasyEditor/releases',
      },
      {
        text: '报告',
        link: 'https://github.com/Easy-Editor/EasyEditor/issues',
      },
      {
        component: 'RainbowAnimationSwitcher',
        props: {
          text: '彩虹动画',
        },
      },
    ],
  },
]

const SidebarGuide: DefaultTheme.SidebarItem[] = [
  {
    text: '指南',
    items: Guides,
  },
  {
    text: 'Config',
    link: '/config/',
  },
]

const SidebarConfigs: DefaultTheme.SidebarItem[] = [
  {
    text: '配置',
    collapsed: false,
    items: Configs,
  },
]

const SidebarReferences: DefaultTheme.SidebarItem[] = [
  {
    text: '参考',
    collapsed: false,
    items: References,
  },
]

const Sidebar: DefaultTheme.Sidebar = {
  '/guide/': SidebarGuide,
  '/config/': SidebarConfigs,
  '/reference/': SidebarReferences,
}

export const zh = defineConfig({
  lang: 'en',
  description,

  themeConfig: {
    nav: Nav,
    sidebar: Sidebar,
  },
})
