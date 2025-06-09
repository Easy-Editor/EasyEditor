# 渲染器开发

渲染器是 EasyEditor 的核心架构之一，负责将设计器中的组件配置渲染为实际可见的界面。EasyEditor 支持多种框架的渲染器实现，本指南将帮助你了解渲染器的基本概念和使用方法。

## 渲染器概述

EasyEditor 的渲染器分为两种模式：

1. **设计态渲染器**：用于在设计器中进行可视化编辑，支持组件选择、拖拽、调整等操作。
2. **运行态渲染器**：用于将设计好的配置渲染为最终用户可交互的界面。

## 内置渲染器

EasyEditor 目前提供以下内置渲染器：

- `@easy-editor/react-renderer`: 基础 React 渲染器
- `@easy-editor/react-renderer-dashboard`: 大屏应用 React 渲染器 (基于React 渲染器扩展)
- `@easy-editor/react-renderer-form`: 表单应用 React 渲染器 (开发中)

## 渲染器使用

### 设计态渲染器

设计态渲染器通常通过 `SimulatorRenderer` 组件实现：

```tsx
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
import { project } from './editor'

export const DesignEditor = () => {
  const { designer } = project
  return <SimulatorRenderer designer={designer} />
}
```

### 运行态渲染器

运行态渲染器通过 `Renderer` 组件实现：

```tsx
import { Renderer } from '@easy-editor/react-renderer-dashboard'
import { components } from './materials'

export const RuntimePreview = ({ schema }) => {
  return (
    <Renderer
      schema={schema}
      components={components}
      viewport={{ width: 1920, height: 1080 }}
    />
  )
}
```

## 渲染器配置

渲染器支持多种配置选项：

```tsx
<Renderer
  // 必须项：组件配置Schema
  schema={schema}

  // 必须项：组件映射
  components={components}

  // 可选项：视口配置
  viewport={{ width: 1920, height: 1080 }}

  // 可选项：设计模式
  designMode={false}

  // 可选项：应用辅助对象，提供工具方法和上下文
  appHelper={{
    utils: {
      navigate: (path) => { /* 导航处理 */ },
      request: (url, options) => { /* API请求处理 */ }
    },
    ctx: {
      currentUser: { /* 用户信息 */ }
    }
  }}

  // ...
/>
```

## 渲染器扩展

EasyEditor 支持开发自定义渲染器来适配不同的框架或特定的应用场景。渲染器扩展可以：

1. **支持新的框架**：如 Vue、Angular 等
2. **定制渲染行为**：例如为特定组件实现定制的渲染逻辑
3. **增强交互能力**：添加新的交互能力、动画效果等

详细的渲染器开发指南，请参考以下章节：

- [使用设计态渲染器](/guide/renderer/editor)
- [使用运行态渲染器](/guide/renderer/runtime)
- [自定义渲染器开发](/guide/renderer/custom)
