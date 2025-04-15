# 使用设计态渲染器

设计态渲染器是 EasyEditor 设计环境中的核心组件，负责将组件库和设计器关联起来，提供拖拽、选中、调整大小等交互能力。本文将指导你如何在项目中正确使用设计态渲染器。

## 基本使用

### 引入渲染器

首先，需要引入对应的设计态渲染器组件和样式：

```tsx
// 导入设计态渲染器组件
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
```

### 配置渲染器

设计态渲染器需要连接到 simulator 实例：

```tsx
import { simulator } from './editor'

const DesignEditor = () => {
  return (
    <div className="design-editor">
      <SimulatorRenderer host={simulator} />
    </div>
  )
}
```

## 配置项

### 核心属性

#### `host` (必需)

设计态渲染器需要连接到simulator实例，通过host属性传入。

```tsx
<SimulatorRenderer host={simulator} />
```

#### `bemTools` (可选)

配置BEM工具的行为和显示，可以设置为对象或false。如果设置为false，将完全禁用BEM工具功能。

```tsx
// 启用并配置 bemTools 工具
<SimulatorRenderer
  host={simulator}
  bemTools={{
    // 是否启用hover组件功能
    detecting: true,

    // 是否启用调整组件大小功能
    resizing: true,

    // 是否启用选中组件功能
    selecting: true,

    // 是否显示参考线
    guideLine: true,

    // 自定义额外内容
    extra: <CustomToolbar />
  }}
/>
```

```tsx
// 完全禁用BEM工具
<SimulatorRenderer
  host={simulator}
  bemTools={false}
/>
```

#### 自定义辅助工具

你可以通过 `bemTools.extra` 属性来添加自定义的辅助工具：

```tsx
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
import { simulator } from './editor'

// 自定义辅助工具组件
const CustomTools = () => {
  return (
    <div className="custom-tools">
      <button
        className="tool-button"
        onClick={() => {
          // 获取当前选中的节点
          const selectedNode = simulator.designer.selection.selected[0]
          if (selectedNode) {
            // 执行自定义操作
            console.log('Selected node:', selectedNode.id)
          }
        }}
      >
        自定义工具
      </button>
    </div>
  )
}

const DesignEditor = () => {
  return (
    <div className="design-editor">
      <SimulatorRenderer
        host={simulator}
        bemTools={{
          // 添加自定义工具
          extra: <CustomTools />
        }}
      />
    </div>
  )
}
```

## 设备视口配置

设计态渲染器会根据画布大小自动调整缩放比例，以适应不同的视口尺寸。默认视口大小为 `1920x1080`，可以通过以下方式自定义：

```ts
// 自定义设备视口大小
simulator.set('deviceStyle', {
  viewport: {
    width: 1920,
    height: 1080,
  },
})
```

## 设计模式与运行模式切换

设计态渲染器会根据 simulator 的 `designMode` 来决定是否展示辅助工具：

```tsx
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
import { simulator } from './editor'
import { useState } from 'react'

const DesignEditor = () => {
  const [isDesignMode, setIsDesignMode] = useState(true)

  const toggleMode = () => {
    // 切换设计模式/运行模式
    simulator.set('designMode', isDesignMode ? 'live' : 'design')
    setIsDesignMode(!isDesignMode)
  }

  return (
    <div className="design-editor">
      <div className="toolbar">
        <button onClick={toggleMode}>
          {isDesignMode ? '运行模式' : '设计模式'}
        </button>
      </div>
      <SimulatorRenderer host={simulator} />
    </div>
  )
}
```

## 渲染器内部结构

设计态渲染器的 DOM 结构如下：

```html
<div class="easy-editor">
  <!-- 画布区域 -->
  <div class="easy-editor-canvas easy-editor-device-default-canvas">
    <!-- 视口区域 -->
    <div class="easy-editor-viewport easy-editor-device-default-viewport">
      <!-- 辅助工具 -->
      <div class="easy-editor-bem-tools">
        <!-- 各种辅助工具 -->
        <div class="easy-editor-border-detecting"></div>
        <div class="easy-editor-border-selecting"></div>
        <div class="easy-editor-border-resizing"></div>
        <div class="easy-editor-guide-line"></div>
        <!-- 自定义工具 -->
      </div>
      <!-- 内容区域 -->
      <div class="easy-editor-content"></div>
    </div>
  </div>
</div>
```

了解这个结构有助于你通过 CSS 自定义渲染器的样式和行为。
