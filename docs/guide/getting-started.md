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
pnpm add mobx

# 安装引擎核心和插件
pnpm add @easyeditor/core
```
:::

EasyEditor 支持多种应用类型，包括大屏、表单等。根据你的需求，可以选择:

- [大屏应用指南](/guide/dashboard) - 了解如何构建可视化大屏应用
- [表单应用指南](/guide/form) - 了解如何构建动态表单应用

## 使用

1. 初始化编辑器：

```typescript
import { createEditor } from '@easyeditor/core'

export const editor = createEasyEditor({
  setters,        // 设置器 - 用于组件属性配置
  components,     // 物料 - 可拖拽使用的组件库
  componentMetas, // 物料元数据 - 组件的配置信息
})
```

2. 获取核心模块

```typescript
// Designer: 设计器核心，负责管理设计器状态和行为
export const designer = await editor.onceGot<Designer>('designer')

// Project: 项目管理，负责项目文档的管理
export const project = await editor.onceGot<Project>('project')

// Simulator: 模拟器，负责组件的渲染和预览
export const simulator = await editor.onceGot<Simulator>('simulator')
```

## 文件结构

推荐使用如下的目录结构来设置：

```
.
├─ src
│  ├─ editor
│  │  ├─ materials      # 物料 - 可拖拽使用的组件
│  │  ├─ plugins        # 插件 - 扩展功能
│  │  ├─ setters        # 设置器 - 属性配置面板
│  │  └─ index.ts       # EasyEditor 入口
│  └─ index.ts
└─ package.json
```

## 核心概念

- **设置器(Setters)**: 用于在设计面板中配置组件属性的UI控件
- **物料(Components)**: 可在设计器中使用的组件库
- **物料元数据(ComponentMetas)**: 描述组件的配置信息，包括可配置的属性、事件等
- **插件(Plugins)**: 扩展EasyEditor功能的模块
- **设计器(Designer)**: 负责管理设计器状态和行为
- **项目(Project)**: 管理项目文档
- **模拟器(Simulator)**: 负责组件的渲染和预览

## 示例项目

可以查看以下示例项目深入了解EasyEditor的使用方法：
- [EasyDashboard](https://github.com/Easy-Editor/EasyDashboard): 大屏应用示例
- 更多示例正在开发中

## 下一步

- 如果想了解 EasyEditor API 参数，可以查看 [API参考]()。
- 想要了解大屏可视化渲染，可以查看 [大屏渲染]()。
- 想要了解表单可视化渲染，可以查看 [表单渲染]()。
- 想要了解渲染器配置，可以查看 [渲染器配置]()。
- 想了解EasyEditor的设计理念，可以查看 [为什么选择 EasyEditor]()。
