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

### 使用脚手架（推荐）

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

### 手动安装

如果你需要集成到现有项目中，可以手动安装依赖：

::: code-group
```sh [基础依赖]
# 用于 core 和 renderer 进行数据驱动和响应式处理
pnpm add mobx mobx-react

# 安装引擎核心
pnpm add @easy-editor/core @easy-editor/renderer-core @easy-editor/react-renderer
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

### 1. 创建并初始化引擎

在一个专用模块中创建实例。当前 Dashboard 插件依赖同 Realm 原型扩展，因此示例显式使用 `legacyTrusted`；不依赖旧插件的新宿主应保留默认的 `agentRestricted`。

```typescript
import { createEngine } from '@easy-editor/core/instance'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import DataSourcePlugin from '@easy-editor/plugin-datasource'
import HotkeyPlugin from '@easy-editor/plugin-hotkey'
import { Group, componentMetaMap } from './materials'
import { setterMap } from './setters'

export const engine = createEngine({
  trustPolicy: 'legacyTrusted',
  hostWindow: window,
})

await engine.plugins.registerPlugins([
  DashboardPlugin({
    group: {
      meta: Group,
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

engine.materials.buildComponentMetasMap(Object.values(componentMetaMap))
engine.setters.registerSetter(setterMap)
await engine.init({ designMode: 'design' })

export const project = engine.project
export const designer = engine.designer
```

一个实例拥有自己的 `project`、`materials`、`setters`、插件和事件。不要把这些对象与 `@easy-editor/core` 根入口的默认 facade 混用。

### 2. 校验并加载项目

宿主通过引擎拥有的边界加载 Schema：

```typescript
import {
  type ProjectSchema,
  validateProjectSchema,
} from '@easy-editor/core/instance'
import { engine } from './runtime'

export function loadProject(schema: ProjectSchema) {
  const validated = validateProjectSchema(schema, engine.trustPolicy)
  engine.loadProject(validated, true)
}
```

`engine.loadProject()` 会再次执行当前策略下的 Schema 准备流程。`agentRestricted` 会拒绝函数、访问器、`JSExpression`、`JSFunction` 和其他可执行 Schema 值。

### 3. 设置模拟器

```typescript
import type { Simulator } from '@easy-editor/core/instance'
import { engine } from './runtime'

export const releaseSimulatorReady = engine.project.onSimulatorReady((simulator: Simulator) => {
  simulator.set('deviceStyle', {
    viewport: { width: 1920, height: 1080 },
  })
})
```

保存返回的取消订阅函数，并在销毁前调用它。

### 4. 使用渲染器

#### 设计态渲染器

```tsx
import { designer } from '@/editor/runtime'
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'

export function DesignEditor() {
  return (
    <div className="editor-container">
      <SimulatorRenderer designer={designer} />
    </div>
  )
}
```

#### 运行态渲染器

```tsx
import { Renderer } from '@easy-editor/react-renderer-dashboard'

export function RuntimePreview({ schema, components }) {
  return (
    <Renderer
      schema={schema}
      components={components}
      viewport={{ width: 1920, height: 1080 }}
    />
  )
}
```

### 5. 销毁引擎

应用卸载、非持久化 `pagehide` 和 HMR dispose 时都要等待 `engine.destroy()`：

```typescript
import { engine, releaseSimulatorReady } from './runtime'

export async function destroyEditor() {
  releaseSimulatorReady()
  await engine.destroy()
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => destroyEditor())
}
```

`destroy()` 是整个实例的清理边界。不要绕过它单独销毁引擎拥有的 Project、物料、设置器或远程 registry。

::: tip v1 项目
如果项目仍从 `@easy-editor/core` 导入 `init`、`project` 等全局对象，请按[从 v1 迁移到 v2](/guide/migration-v2)逐步切换到显式实例。
:::

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
