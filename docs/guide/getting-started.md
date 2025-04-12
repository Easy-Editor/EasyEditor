---
title: 快速开始
description: EasyEditor 的使用
---

# 快速开始

本指南将帮助你快速上手 EasyEditor，一个用于构建可视化应用平台的插件化跨框架低代码引擎。

## 前置准备

- [Node.js](https://nodejs.org/) 18 及以上版本。
- [pnpm](https://pnpm.io/) 9.12.2 及以上版本。

::: info
强烈建议使用 pnpm 作为包管理器，同时 EasyEditor 的依赖管理仅支持 pnpm 安装。
:::

## 安装

::: code-group
```sh [pnpm]
# 用于 core 和 renderer 进行数据驱动和响应式处理
pnpm add mobx mobx-react

# 安装引擎核心
pnpm add @easyeditor/core
```
:::

EasyEditor 支持多种应用场景，请根据你的需求选择安装对应的插件和渲染器：

::: code-group
```sh [大屏应用]
# 安装大屏设计插件和渲染器
pnpm add @easyeditor/plugin-dashboard @easyeditor/react-renderer-dashboard
```

```sh [表单应用]
# 安装表单设计插件和渲染器（开发中）
pnpm add @easyeditor/plugin-form @easyeditor/react-renderer-form
```
:::

## 基本使用

### 1. 初始化编辑器

创建编辑器实例是使用 EasyEditor 的第一步：

```typescript
import { createEditor } from '@easyeditor/core'
import DashboardPlugin from '@easyeditor/plugin-dashboard'

// 创建编辑器实例
export const editor = createEditor({
  // 添加所需插件
  plugins: [DashboardPlugin()],

  // 设置器 - 用于组件属性配置
  setters: {
    // 配置各种设置器组件
    StringSetter: StringSetterComponent,
    NumberSetter: NumberSetterComponent,
    // ...
  },

  // 物料 - 可拖拽使用的组件库
  components: {
    Text: TextComponent,
    Button: ButtonComponent,
    Chart: ChartComponent,
    // ...
  },

  // 物料元数据 - 组件的配置信息
  componentMetas: {
    Text: {
      title: '文本',
      props: [
        {
          name: 'content',
          title: '内容',
          setter: 'StringSetter'
        }
        // ...
      ]
    },
    // ...
  }
})
```

### 2. 获取核心模块

初始化编辑器后，您可以获取各个核心模块：

```typescript
// Designer: 设计器核心，负责管理设计器状态和行为
export const designer = await editor.onceGot('designer')

// Project: 项目管理，负责项目文档的管理
export const project = await editor.onceGot('project')

// Simulator: 模拟器，负责组件的渲染和预览
export const simulator = await editor.onceGot('simulator')
```

### 3. 使用渲染器

EasyEditor 提供了两种渲染模式：

```tsx
// 导入相关渲染器组件
import { SimulatorRenderer, Renderer } from '@easyeditor/react-renderer-dashboard'

// 设计态渲染器 - 用于编辑环境
const DesignEditor = () => {
  return <SimulatorRenderer host={simulator} />
}

// 运行态渲染器 - 用于预览或生产环境
const RuntimePreview = ({ schema }) => {
  return (
    <Renderer
      schema={schema}
      components={components}
      viewport={{ width: 1920, height: 1080 }}
    />
  )
}
```

## 推荐的项目结构

为了更好地组织代码，我们推荐使用如下的目录结构：

```
src/
├── editor/
│   ├── materials/      # 物料 - 组件定义和配置
│   │   ├── components/ # 组件实现
│   │   ├── setters/    # 属性设置器实现
│   │   └── index.ts    # 物料导出
│   ├── plugins/        # 自定义插件
│   ├── config/         # 编辑器配置
│   └── index.ts        # 编辑器初始化
├── pages/              # 应用页面
│   ├── editor.tsx      # 设计器页面
│   └── preview.tsx     # 预览页面
└── index.tsx           # 应用入口
```

## 场景实践

EasyEditor 支持多种应用场景，每种场景都有其特定的插件和渲染器：

### 大屏应用

大屏应用场景提供了丰富的可视化组件和布局系统，适用于数据大屏、监控中心等场景。

::: tip
查看 [大屏应用指南](/guide/scenarios/dashboard) 了解如何构建专业的可视化大屏应用。
:::

### 表单应用

表单应用场景提供了强大的表单设计能力，支持复杂的数据录入和验证逻辑。

::: info 开发中
表单应用场景正在积极开发中，敬请期待！查看 [表单应用指南](/guide/scenarios/form) 了解最新进展。
:::

## 核心概念

了解以下核心概念将帮助您更好地使用 EasyEditor：

- **编辑器(Editor)**: 整个低代码平台的核心，负责协调各个模块的工作
- **设计器(Designer)**: 负责页面编排和交互的模块
- **项目(Project)**: 管理文档和资源的模块
- **模拟器(Simulator)**: 提供预览和调试能力的模块
- **插件(Plugins)**: 扩展 EasyEditor 功能的模块
- **设置器(Setters)**: 用于配置组件属性的 UI 控件
- **物料(Components)**: 可在设计器中使用的组件库
- **物料元数据(ComponentMetas)**: 描述组件的配置信息

::: tip
查看 [核心概念](/guide/core-concepts) 文档深入了解 EasyEditor 的架构设计。
:::

## 示例项目

可以查看以下示例项目深入了解 EasyEditor 的使用方法：

- [EasyDashboard](https://github.com/Easy-Editor/EasyDashboard): 基于 EasyEditor 构建的专业大屏应用示例
- 更多示例正在开发中

## 下一步

- 了解 [EasyEditor 的设计理念](/guide/why)
- 探索 [核心概念](/guide/core-concepts) 深入理解架构
- 学习如何进行 [插件扩展](/guide/extension/plugin)
- 查看 [大屏应用指南](/guide/scenarios/dashboard) 构建数据可视化应用
- 参考 [API 文档](/reference/overview) 获取详细的 API 信息
