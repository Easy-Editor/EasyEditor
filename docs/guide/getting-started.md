# 快速开始

本指南将帮助你快速上手 EasyEditor，一个用于构建可视化应用平台的插件化跨框架低代码引擎。

## 环境准备

- [Node.js](https://nodejs.org/) 18 及以上版本。
- [pnpm](https://pnpm.io/) 9.12.2 及以上版本。

::: info 提示
强烈建议使用 pnpm 作为包管理器，同时 EasyEditor 的依赖管理也限制为仅支持 pnpm 安装。
:::

## 创建项目

EasyEditor 提供两种方式来创建项目：

### 方式一：使用脚手架（推荐）

使用官方脚手架可以快速创建一个完整的 EasyEditor 项目：

::: code-group
```sh [pnpm]
pnpm create @easy-editor my-project
```

```sh [npm]
npm init @easy-editor my-project
```

```sh [npx]
npx @easy-editor/create my-project
```
:::

脚手架会引导你选择应用场景和框架：

- **应用场景**：
  - Dashboard（大屏应用）
  - Form（表单应用，开发中）

- **框架**：
  - React
  - Vue（开发中）

创建完成后，进入项目目录并启动开发服务器：

```sh
cd my-project
pnpm install
pnpm dev
```

### 方式二：手动安装

如果你需要集成到现有项目中，可以手动安装依赖：

::: code-group
```sh [基础依赖]
# 用于 core 和 renderer 进行数据驱动和响应式处理
pnpm add mobx mobx-react

# 安装引擎核心
pnpm add @easy-editor/core
```
:::

根据你的应用场景选择安装对应的插件和渲染器：

::: code-group
```sh [大屏应用]
# 安装大屏设计插件和渲染器
pnpm add @easy-editor/plugin-dashboard @easy-editor/react-renderer-dashboard
```

```sh [表单应用]
# 安装表单设计插件和渲染器（开发中）
```
:::

## 基本使用

### 1. 初始化编辑器

```typescript
import {
  init,
  materials,
  plugins,
  project,
  setters,
} from '@easy-editor/core'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import DataSourcePlugin from '@easy-editor/plugin-datasource'
import HotkeyPlugin from '@easy-editor/plugin-hotkey'

// 注册插件
plugins.registerPlugins([
  DashboardPlugin({
    group: {
      meta: groupMeta,
      initSchema: {
        componentName: 'Group',
        title: '分组',
        isGroup: true,
      },
    },
  }),
  DataSourcePlugin(),
  HotkeyPlugin(),
])

// 构建组件元数据
materials.buildComponentMetasMap(Object.values(componentMetaMap))

// 注册设置器
setters.registerSetter(setterMap)

// 初始化引擎
await init({
  designMode: 'design',
  appHelper: {
    utils: {
      // 自定义工具函数
    },
  },
})
```

### 2. 获取核心模块

初始化后，你可以直接使用导出的核心模块：

```typescript
import { project, plugins, materials, setters } from '@easy-editor/core'

// Designer: 设计器核心，通过 project.designer 访问
const { designer } = project

// Project: 项目管理，负责项目文档的管理
// 已经可以直接使用 project

// 其他模块也可以直接使用
console.log('插件:', plugins)
console.log('物料:', materials)
console.log('设置器:', setters)
```

### 3. 设置项目数据和模拟器

```typescript
import { type Simulator } from '@easy-editor/core'

// 监听模拟器准备就绪
project.onSimulatorReady((simulator: Simulator) => {
  // 设置画布尺寸
  simulator.set('deviceStyle', {
    viewport: { width: 1920, height: 1080 }
  })

  // 加载项目模式
  project.load(projectSchema, true)
})
```

### 4. 使用渲染器

EasyEditor 提供了两种渲染模式：

#### 设计态渲染器

用于编辑环境，提供拖拽、选择等交互功能：

```tsx
import { project } from '@easy-editor/core'
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
import { observer } from 'mobx-react'

const DesignEditor = observer(() => {
  const { designer } = project

  return (
    <div className="editor-container">
      <SimulatorRenderer designer={designer} />
    </div>
  )
})
```

#### 运行态渲染器

用于预览或生产环境，只渲染内容不提供编辑功能：

```tsx
import { Renderer } from '@easy-editor/react-renderer-dashboard'

const RuntimePreview = ({ schema, components }) => {
  return (
    <Renderer
      schema={schema}
      components={components}
      viewport={{ width: 1920, height: 1080 }}
    />
  )
}
```

## 核心概念

了解以下核心概念将帮助您更好地使用 EasyEditor：

- **引擎(Engine)**: 整个低代码平台的核心，负责协调各个模块的工作
- **设计器(Designer)**: 负责页面编排和交互的模块
- **项目(Project)**: 管理文档和资源的模块
- **模拟器(Simulator)**: 提供预览和调试能力的模块
- **插件(Plugins)**: 扩展 EasyEditor 功能的模块
- **设置器(Setters)**: 用于配置组件属性的 UI 控件
- **物料(Materials)**: 可在设计器中使用的组件库
- **物料元数据(ComponentMetas)**: 描述组件的配置信息

::: tip 提示
查看 [核心概念](/guide/core-concepts) 文档深入了解 EasyEditor 的架构设计。
:::

## 项目结构

推荐使用如下的目录结构：

### 脚手架项目结构

使用脚手架创建的项目已经包含完整的目录结构：

```
my-project/
├── src/
│   ├── editor/
│   │   ├── materials/      # 物料 - 组件定义和配置
│   │   │   ├── components/ # 组件实现
│   │   │   ├── meta/       # 组件元数据
│   │   │   └── index.ts    # 物料导出
│   │   ├── setters/        # 属性设置器实现
│   │   ├── const.ts        # 常量和默认配置
│   │   └── index.ts        # 编辑器初始化
│   ├── components/         # 应用组件
│   │   ├── Center.tsx      # 中心画布区域
│   │   ├── Left.tsx        # 左侧面板
│   │   └── Right.tsx       # 右侧面板
│   ├── pages/              # 应用页面
│   │   └── index.tsx       # 主页面
│   └── App.tsx             # 应用入口
├── package.json
└── README.md
```

### 手动集成项目结构

手动集成到现有项目时的推荐结构：

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

::: tip 提示
查看 [大屏应用指南](./scenarios/dashboard/index) 了解如何构建专业的可视化大屏应用。
:::

### 表单应用

表单应用场景提供了强大的表单设计能力，支持复杂的数据录入和验证逻辑。

::: info 开发中
表单应用场景正在积极开发中，敬请期待！查看 [表单应用指南](./scenarios/form/index) 了解最新进展。
:::

## 示例项目

可以查看以下示例项目深入了解 EasyEditor 的使用方法：

- [EasyDashboard](https://github.com/Easy-Editor/EasyDashboard): 基于 EasyEditor 构建的专业大屏应用示例
- 更多示例正在开发中

## 下一步

- 了解 [EasyEditor 的设计理念](./why)
- 探索 [核心概念](./core-concepts) 深入理解架构
- 学习如何进行 [插件扩展](./extension/plugin)
- 查看 [大屏应用指南](./scenarios/dashboard/index) 构建数据可视化应用
- 参考 [API 文档](../reference/overview) 获取详细的 API 信息
