# 使用编辑态渲染器

编辑态渲染器是 EasyEditor 设计环境中的核心组件，负责将组件库和设计器关联起来，提供拖拽、选中、调整大小等交互能力。本文将指导你如何在项目中正确使用编辑态渲染器。

## 基本使用

### 引入渲染器

首先，你需要引入对应的编辑态渲染器组件和样式：

```tsx
// 导入编辑态渲染器组件
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
```

### 配置渲染器

编辑态渲染器需要连接到 simulator 实例：

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

`SimulatorRenderer` 组件支持以下配置项：

```tsx
<SimulatorRenderer
  // 必填项：simulator 实例
  host={simulator}

  // 可选项：BemTools 配置
  bemTools={{
    // 是否启用 hover 组件功能
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

你也可以通过设置 `bemTools={false}` 来完全禁用 BemTools 功能。

## 工作原理

编辑态渲染器的工作流程如下：

1. **挂载渲染器**：渲染器通过 `host` 属性连接到 simulator 实例
2. **初始化文档实例**：渲染器为每个文档创建 DocumentInstance
3. **设置设计模式**：在设计模式下启用辅助工具（BemTools）
4. **监听变更**：通过 MobX 自动响应文档和视口变化
5. **渲染组件**：将 schema 通过 LowCodeRenderer 渲染为实际组件

## 实现设备自适应

编辑态渲染器会根据画布大小自动调整缩放比例，以适应不同的视口尺寸：

```tsx
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
import { simulator } from './editor'
import { useEffect } from 'react'

const DevicePreview = () => {
  // 设置设备视口
  useEffect(() => {
    // 修改 simulator 的设备配置
    simulator.deviceStyle = {
      viewport: {
        width: 375,  // 移动设备宽度
        height: 667  // 移动设备高度
      }
    }

    // 可以监听窗口变化自动调整比例
    const handleResize = () => {
      simulator.viewport.updateScale()
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div className="design-container">
      <SimulatorRenderer host={simulator} />
    </div>
  )
}
```

## 自定义辅助工具

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

## 设计模式与运行模式切换

编辑态渲染器会根据 simulator 的 `designMode` 来决定是否展示辅助工具：

```tsx
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
import { simulator } from './editor'
import { useState } from 'react'

const DesignEditor = () => {
  const [isDesignMode, setIsDesignMode] = useState(true)

  const toggleMode = () => {
    // 切换设计模式/运行模式
    simulator.designMode = isDesignMode ? 'live' : 'design'
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

编辑态渲染器的 DOM 结构如下：

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

## 下一步

- 了解[运行态渲染器](/guide/renderer/runtime)的使用方法
- 查看[API 参考](/reference/renderer)获取更详细的信息
