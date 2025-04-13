import { type DefaultTheme, defineConfig } from 'vitepress'
import { version } from '../../../packages/core/package.json'

const description = '用于构建可视化应用平台的插件化跨框架低代码引擎'

// 入门指南
const GettingStartedGuides: DefaultTheme.NavItemWithLink[] = [
  { text: '为什么选择 EasyEditor', link: '/guide/why' },
  { text: '快速开始', link: '/guide/getting-started' },
  { text: '核心概念', link: '/guide/core-concepts' },
]

// 扩展开发
const ExtensionGuides: DefaultTheme.NavItemWithLink[] = [
  { text: '插件扩展', link: '/guide/extension/plugin' },
  { text: '物料扩展', link: '/guide/extension/material' },
  { text: '设置器扩展', link: '/guide/extension/setter' },
]

// 渲染器开发
const RendererGuides: DefaultTheme.NavItemWithLink[] = [
  { text: '概述', link: '/guide/renderer/' },
  { text: '使用设计态', link: '/guide/renderer/editor' },
  { text: '使用运行态', link: '/guide/renderer/runtime' },
  { text: '渲染器定制', link: '/guide/renderer/custom' },
]

// 场景实践
const ScenarioGuides: DefaultTheme.SidebarItem[] = [
  {
    text: '大屏设计',
    collapsed: true,
    items: [
      { text: '介绍', link: '/guide/scenarios/dashboard/' },
      { text: '快速开始', link: '/guide/scenarios/dashboard/getting-started' },
    ],
  },
  {
    text: '表单设计',
    collapsed: true,
    items: [
      { text: '介绍', link: '/guide/scenarios/form/' },
      { text: '快速开始', link: '/guide/scenarios/form/getting-started' },
    ],
  },
]

// 设计功能
const Designs: DefaultTheme.NavItemWithLink[] = [
  { text: '架构综述', link: '/design/overview' },
  { text: '协议栈简介', link: '/design/specs' },
  { text: '编排模块', link: '/design/editor' },
  { text: '渲染模块', link: '/design/renderer' },
  { text: '插件系统', link: '/design/plugin' },
  { text: '设置器模块', link: '/design/setter' },
]

// API 参考
const References: DefaultTheme.SidebarItem[] = [
  { text: '总览', link: '/reference/overview' },
  {
    text: 'Core',
    items: [{ text: 'Editor', link: '/reference/core' }],
  },
  {
    text: 'Renderer',
    items: [{ text: 'Renderer', link: '/reference/renderer' }],
  },
  {
    text: 'Plugin',
    items: [{ text: 'Plugin', link: '/reference/plugin' }],
  },
]

const SidebarGuide: DefaultTheme.SidebarItem[] = [
  {
    text: '入门指南',
    items: GettingStartedGuides,
  },
  {
    text: '扩展开发',
    items: ExtensionGuides,
  },
  {
    text: '渲染器开发',
    items: RendererGuides,
  },
  {
    text: '场景实践',
    items: ScenarioGuides,
  },
  {
    text: '设计原理',
    link: '/design/',
  },
  {
    text: 'API 参考',
    link: '/reference/',
  },
]

const Nav: DefaultTheme.NavItem[] = [
  {
    text: '指南',
    items: [
      {
        text: '入门指南',
        items: GettingStartedGuides.slice(0, 2),
      },
      {
        text: '场景实践',
        items: [
          { text: '大屏设计', link: '/guide/scenarios/dashboard/' },
          { text: '表单设计', link: '/guide/scenarios/form/' },
        ],
      },
    ],
    activeMatch: '^/guide/',
  },
  {
    text: '原理',
    items: Designs,
  },
  {
    text: '参考',
    items: [
      { text: '总览', link: '/reference/overview/' },
      { text: 'Core', link: '/reference/core/' },
      { text: 'Plugin', link: '/reference/plugin/' },
      { text: 'Renderer', link: '/reference/renderer/' },
    ],
    activeMatch: '^/reference/',
  },
  {
    text: '资源',
    items: [{ text: 'EasyDashboard', link: 'https://github.com/Easy-Editor/EasyDashboard', target: '_blank' }],
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

const Sidebar: DefaultTheme.Sidebar = {
  '/guide/': SidebarGuide,
  '/design/': Designs,
  '/reference/': References,
}

export const zh = defineConfig({
  lang: 'zh',
  description,

  themeConfig: {
    nav: Nav,
    sidebar: Sidebar,
  },
})
