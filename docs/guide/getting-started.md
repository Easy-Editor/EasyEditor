---
title: 快速开始
description: EasyEditor 的使用
---

# 快速开始

## 前置准备

- [Node.js](https://nodejs.org/) 18 及以上版本。
- [pnpm](https://pnpm.io/) 9.12.2 及以上版本。

::: info
强烈建议使用 pnpm 作为包管理器，同时 EasyEditor 的依赖管理仅支持 pnpm 安装。
:::

::: code-group

```sh [pnpm]
$ pnpm add @easyeditor/core
```

:::

## 安装使用

### 大屏可视化搭建

1. 安装必要依赖：

::: code-group

```sh [pnpm]
# 安装核心依赖，用于数据驱动和响应式处理
pnpm add mobx mobx-react

# 安装引擎核心和插件
pnpm install @easyeditor/core @easyeditor/plugin-dashboard @easyeditor/react-renderer-dashboard
```

:::

2. 初始化编辑器：

```typescript
import { createEditor } from '@easyeditor/core'
import DashboardPlugin from '@easyeditor/plugin-dashboard'

export const editor = createEasyEditor({
  plugins: [DashboardPlugin()],
  setters,
  components,
  componentMetas,
})

// 获取核心模块
export const designer = await editor.onceGot<Designer>('designer')
export const project = await editor.onceGot<Project>('project')
export const simulator = await editor.onceGot<Simulator>('simulator')
```

3. 实现渲染器：

```tsx
// 设计态
import { SimulatorRenderer } from '@easyeditor/react-renderer-dashboard'

const DesignMode = () => (
  <SimulatorRenderer host={simulator} />
)

// 预览态
import { ReactRenderer } from '@easyeditor/react-renderer-dashboard'

const PreviewMode = () => (
  <ReactRenderer components={simulator.components} schema={docSchema} />
)
```
