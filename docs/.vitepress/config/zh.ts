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
  { text: '使用编辑态', link: '/guide/renderer/editor' },
  { text: '使用运行态', link: '/guide/renderer/runtime' },
  { text: '渲染器定制', link: '/guide/renderer/custom' },
  { text: '主题定制', link: '/guide/renderer/theme' },
]

// 场景实践
const ScenarioGuides: DefaultTheme.SidebarItem[] = [
  {
    text: '大屏设计',
    collapsed: true,
    items: [
      { text: '介绍', link: '/guide/scenarios/dashboard/' },
      { text: '快速开始', link: '/guide/scenarios/dashboard/getting-started' },
      { text: '组件配置', link: '/guide/scenarios/dashboard/components' },
      { text: '主题定制', link: '/guide/scenarios/dashboard/theme' },
      { text: '最佳实践', link: '/guide/scenarios/dashboard/best-practices' },
    ],
  },
  {
    text: '表单设计',
    collapsed: true,
    items: [
      { text: '介绍', link: '/guide/scenarios/form/' },
      { text: '快速开始', link: '/guide/scenarios/form/getting-started' },
      { text: '字段配置', link: '/guide/scenarios/form/fields' },
      { text: '校验规则', link: '/guide/scenarios/form/validation' },
      { text: '最佳实践', link: '/guide/scenarios/form/best-practices' },
    ],
  },
]

// 设计功能
const DesignGuides: DefaultTheme.NavItemWithLink[] = [
  { text: '架构综述', link: '/guide/design/overview' },
  { text: '协议栈简介', link: '/guide/design/specs' },
  { text: '编排模块', link: '/guide/design/editor' },
  { text: '渲染模块', link: '/guide/design/renderer' },
  { text: '插件系统', link: '/guide/design/plugin' },
  { text: '设计器模块', link: '/guide/design/setter' },
]

// API 参考
const References: DefaultTheme.NavItemWithLink[] = [
  { text: '核心 API', link: '/reference/core' },
  { text: '渲染器 API', link: '/reference/renderer' },
  { text: '插件 API', link: '/reference/plugin' },
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
        text: '扩展开发',
        items: ExtensionGuides.slice(0, 2),
      },
      {
        text: '渲染器开发',
        items: RendererGuides.slice(0, 2),
      },
    ],
    activeMatch: '^/guide/',
  },
  {
    text: '原理',
    items: DesignGuides,
  },
  {
    text: '参考',
    items: References,
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
  '/design/': DesignGuides,
  '/reference/': [
    {
      text: 'API 参考',
      collapsed: false,
      items: References,
    },
  ],
}

export const zh = defineConfig({
  lang: 'zh',
  description,

  themeConfig: {
    nav: Nav,
    sidebar: Sidebar,
  },
})
