import { type DefaultTheme, defineConfig } from 'vitepress'
import { version } from '../../../packages/core/package.json'

const description = '用于构建可视化应用平台的插件化跨框架低代码引擎'

// 入门指南
const GettingStartedGuides: DefaultTheme.NavItemWithLink[] = [
  { text: '为什么选择 EasyEditor', link: '/guide/why' },
  { text: '快速开始', link: '/guide/getting-started' },
  { text: '安装', link: '/guide/getting-started/installation' },
  { text: '基础概念', link: '/guide/getting-started/concepts' },
  { text: '第一个应用', link: '/guide/getting-started/first-app' },
]

// 核心功能
const DesignGuides: DefaultTheme.NavItemWithLink[] = [
  { text: '架构综述', link: '/guide/design/overview' },
  { text: '协议栈简介', link: '/guide/design/specs' },
  { text: '编排模块', link: '/guide/design/editor' },
  { text: '渲染模块', link: '/guide/design/renderer' },
  { text: '插件系统', link: '/guide/design/plugin' },
  { text: '设计器模块', link: '/guide/design/setter' },
]

// 插件开发
const ExtensionGuides: DefaultTheme.NavItemWithLink[] = [
  { text: '渲染器开发', link: '/guide/renderer/' },
  { text: '自定义渲染器', link: '/guide/renderer/custom' },
  { text: '组件适配', link: '/guide/renderer/components' },
  // { text: '主题定制', link: '/guide/renderer/theme' },
]

// 场景实践
const ScenarioGuides: DefaultTheme.NavItemWithLink[] = [
  { text: '大屏设计', link: '/guide/dashboard/' },
  { text: '快速开始', link: '/guide/dashboard/getting-started' },
  { text: '组件配置', link: '/guide/dashboard/config' },
  { text: '渲染器使用', link: '/guide/dashboard/renderer' },
  { text: '主题定制', link: '/guide/dashboard/theme' },
]

// 进阶主题
const AdvancedGuides: DefaultTheme.NavItemWithLink[] = [
  { text: '性能优化', link: '/guide/advanced/performance' },
  { text: '国际化', link: '/guide/advanced/i18n' },
  { text: '数据源管理', link: '/guide/advanced/data-source' },
  { text: '版本控制', link: '/guide/advanced/version-control' },
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
    text: '引擎设计',
    items: DesignGuides,
  },
  {
    text: '扩展开发',
    items: ExtensionGuides,
  },
  {
    text: '场景实践',
    items: [
      {
        text: '大屏设计',
        collapsed: true,
        items: ScenarioGuides,
      },
      {
        text: '表单设计',
        collapsed: true,
        items: [
          { text: '快速开始', link: '/guide/form/getting-started' },
          { text: '字段类型', link: '/guide/form/fields' },
          { text: '验证规则', link: '/guide/form/validation' },
        ],
      },
    ],
  },
  // {
  //   text: '进阶主题',
  //   items: AdvancedGuides,
  // },
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
        text: '核心功能',
        items: DesignGuides.slice(0, 2),
      },
      {
        text: '场景实践',
        items: [
          { text: '大屏设计', link: '/guide/dashboard/' },
          { text: '表单设计', link: '/guide/form/' },
        ],
      },
    ],
    activeMatch: '^/guide/',
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
