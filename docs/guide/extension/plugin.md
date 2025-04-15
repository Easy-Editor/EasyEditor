# 插件扩展

插件是 EasyEditor 的功能扩展机制，通过插件可以扩展编辑器的功能，增强核心能力。本指南将帮助你了解如何开发和集成自定义插件。

## 概述

插件是 EasyEditor 的扩展单元，用于增强编辑器的功能。插件可以：

- 添加新功能和物料组件
- 扩展现有类的方法和属性
- 监听和响应编辑器事件
- 与其他插件协作和通信
- 集成第三方库和服务

EasyEditor 采用了"微内核+插件"的架构设计，大部分功能都是通过插件实现的，这使得编辑器非常灵活和可扩展。

## 生命周期

插件遵循以下生命周期：

1. **注册阶段**：插件向编辑器注册，设置插件名称、依赖等基本信息
2. **扩展阶段**：如果存在 `extend` 方法，调用它来扩展核心类
3. **初始化阶段**：调用插件的 `init` 方法，设置事件监听，初始化资源
4. **运行阶段**：插件正常工作，响应事件，提供功能
5. **销毁阶段**：调用插件的 `destroy` 方法，清理资源，移除事件监听

编辑器会确保按照正确的依赖顺序初始化插件，并在适当的时候销毁插件。

## 目录结构

一个完整的插件通常包含以下文件结构：

```bash
my-plugin/
├── index.ts               # 插件入口
└── types.ts               # 类型定义
```

最简单的插件可以只有一个入口文件。

## 使用

### 基础插件

最基本的插件示例：

```ts
import type { PluginCreator } from '@easy-editor/core'

// 插件工厂函数，可接收配置参数
const MyPlugin: PluginCreator<Option> = (options = {}) => {
  // 返回插件定义
  return {
    name: 'MyPlugin',              // 插件名称，必须唯一
    deps: [],                      // 依赖的其他插件
    init(ctx) {                    // 初始化方法
      ctx.logger.info('MyPlugin initialized')

      // 注册全局变量，可以被其他插件访问
      ctx.set('myPluginData', {
        version: '1.0.0',
        ...options
      })

      // 注册事件监听
      ctx.event.on('document.open', (doc) => {
        ctx.logger.info('Document opened:', doc.id)
      })
    },
    destroy(ctx) {                 // 销毁方法
      ctx.logger.info('MyPlugin destroyed')

      // 移除事件监听，避免内存泄漏
      ctx.event.off('document.open')
    }
  }
}

export default MyPlugin
```

### 事件处理插件

处理编辑器事件的插件示例：

```ts
import { type PluginCreator, DESIGNER_EVENT } from '@easy-editor/core'

const EventHandlerPlugin: PluginCreator = () => {
  return {
    name: 'EventHandlerPlugin',
    deps: [],
    init(ctx) {
      const { designer } = ctx

      // 监听组件选择事件
      designer.onEvent(DESIGNER_EVENT.SELECTION_CHANGE, (nodeIds) => {
        const node = designer.currentDocument?.getNode(nodeIds[0])
        if (node) {
          ctx.logger.info('Selected component:', node.componentName)
        }
      })

      // 监听属性变更事件
      designer.onEvent(DESIGNER_EVENT.NODE_PROPS_CHANGE, ({ node, prop, newvalue }) => {
        ctx.logger.info(`Property ${prop} of ${node.id} changed to:`, newvalue)
      })

      // 监听拖拽事件
      designer.onEvent(DESIGNER_EVENT.DRAG_END, (e) => {
        ctx.logger.info('Component dropped:', e)
      })
    }
  }
}

export default EventHandlerPlugin
```

### 功能扩展插件

扩展编辑器核心类的插件示例：

```ts
import type { Plugin } from '@easy-editor/core'

const ExtendPlugin = (): Plugin => {
  return {
    name: 'ExtendPlugin',
    deps: [],
    init(ctx) {
      ctx.logger.info('ExtendPlugin initialized')
    },
    // 扩展核心类
    extend({ extendClass, extend }) {
      const { Node, Document } = extendClass

      // 扩展 Node 类
      extend('Node', {
        // 添加自定义方法
        duplicate: {
          value(this: Node) {
            const parent = this.parent
            if (!parent) return null

            const index = parent.children.indexOf(this)
            const schema = this.export()

            // 创建副本
            return parent.document.createNode({
              ...schema,
              id: undefined,  // 让系统生成新ID
              props: {
                ...schema.props,
                label: `${schema.props?.label || 'Component'} Copy`
              }
            }, parent, { index: index + 1 })
          }
        },
        // 添加自定义属性
        isContainer: {
          get(this: Node) {
            // 检查节点是否为容器类型
            return this.componentMeta?.configure?.component?.isContainer || false
          }
        }
      })
    }
  }
}

export default ExtendPlugin
```

### 注册插件

在编辑器初始化时注册插件：

```ts
import { createEditor } from '@easy-editor/core'
import MyPlugin from './plugins/my-plugin'
import EventHandlerPlugin from './plugins/event-handler-plugin'
import ExtendPlugin from './plugins/extend-plugin'

const editor = createEditor({
  // ...其他配置
  plugins: [
    MyPlugin({ debug: true }),
    EventHandlerPlugin(),
    ExtendPlugin()
  ]
})

// 也可以在编辑器创建后动态注册插件
editor.pluginManager.register(
  MyNewPlugin(),
  { autoInit: true }  // 立即初始化
)
```

## 通信模式

插件之间可以通过以下方式进行通信：

### 事件通信

通过编辑器的事件系统进行通信：

```ts
// 插件 A
init(ctx) {
  // 触发自定义事件
  ctx.event.emit('pluginA.dataChanged', { someData: 'value' })
}

// 插件 B
init(ctx) {
  // 监听插件 A 的事件
  ctx.event.on('pluginA.dataChanged', (data) => {
    console.log('Received data from Plugin A:', data)
  })
}
```

### 共享上下文

通过插件上下文共享数据和方法：

```ts
// 插件 A
init(ctx) {
  // 注册共享服务
  ctx.set('dataService', {
    getData: () => ({ value: 42 }),
    setData: (data) => console.log('Data set:', data)
  })
}

// 插件 B
init(ctx) {
  // 获取插件 A 注册的服务
  const dataService = ctx.get('dataService')
  if (dataService) {
    const data = dataService.getData()
    console.log('Got data:', data)
    dataService.setData({ newValue: 100 })
  }
}
```

### 访问扩展方法

通过扩展方法进行通信：

```ts
// 插件 A 扩展了 Node 类
extend({ extend }) {
  extend('Node', {
    pluginAMethod: {
      value(this: Node, param: string) {
        return `Plugin A method: ${param}`
      }
    }
  })
}

// 插件 B 使用插件 A 的扩展方法
init(ctx) {
  ctx.event.on('node.select', (nodeId) => {
    const node = ctx.designer.currentDocument?.getNode(nodeId)
    if (node && typeof node['pluginAMethod'] === 'function') {
      const result = node['pluginAMethod']('test')
      console.log(result)  // 输出: "Plugin A method: test"
    }
  })
}
```

## 配置项

### 核心属性

#### `name` (必需)

定义插件的唯一名称，用于识别插件和处理依赖关系。

```ts
{
  name: 'MyPlugin'
}
```

#### `deps` (可选)

定义插件依赖的其他插件列表。EasyEditor 会确保依赖的插件在当前插件之前加载和初始化。

```ts
{
  deps: ['CorePlugin', 'UIPlugin']  // 依赖 CorePlugin 和 UIPlugin
}
```

#### `eventPrefix` (可选)

定义插件的事件前缀，用于区分不同插件的事件。如果不设置，则使用 'common' 作为前缀。

```ts
{
  eventPrefix: 'my-plugin'  // 事件名将变为 'my-plugin.eventName'
}
```

### 核心方法

#### `init` (必需)

插件初始化方法，在编辑器启动时执行。可以是同步或异步函数。

```ts
{
  init(ctx) {
    // 初始化逻辑
    ctx.logger.info('Plugin initialized')

    // 订阅事件
    ctx.event.on('document.open', (doc) => {
      // 处理事件
    })

    // 异步初始化示例
    // return new Promise((resolve) => {
    //   setTimeout(() => {
    //     // 异步操作完成
    //     resolve()
    //   }, 1000)
    // })
  }
}
```

#### `destroy` (可选)

插件销毁方法，在插件被移除时执行，用于清理资源。

```ts
{
  destroy(ctx) {
    // 清理资源
    ctx.logger.info('Plugin destroyed')

    // 取消事件订阅
    ctx.event.off('document.open')

    // 清除定时器
    clearInterval(this.timer)

    // 销毁DOM元素
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element)
    }
  }
}
```

#### `extend` (可选)

扩展编辑器核心类的方法，可以添加新的方法或属性，修改现有行为。

```ts
{
  extend({ extendClass, extend }) {
    const { Node, Document } = extendClass

    // 扩展 Node 类
    extend('Node', {
      // 添加方法
      customMethod: {
        value(this: Node, param: string) {
          return `Custom method with param: ${param}`
        }
      },

      // 添加属性
      customProperty: {
        get(this: Node) {
          return this.getExtraPropValue('customProp')
        },
        set(this: Node, value) {
          this.setExtraPropValue('customProp', value)
        }
      }
    })

    // 扩展 Document 类
    extend('Document', {
      // 添加方法
      customDocumentMethod: {
        value(this: Document) {
          return 'Custom document method'
        }
      }
    })
  }
}
```

## 上下文 (Context)

插件上下文 `ctx` 是一个包含编辑器核心功能的对象，提供了访问和操作编辑器各个部分的能力。主要包括：

### 核心模块访问

```ts
// 获取编辑器实例
const editor = ctx.editor
// 获取设计器实例
const designer = ctx.designer
// 获取项目管理实例
const project = ctx.project
// 获取模拟器实例
const simulator = ctx.simulator
// 获取设置器管理实例
const setterManager = ctx.setterManager
// 获取组件元数据管理实例
const componentMetaManager = ctx.componentMetaManager
// 获取热键管理
const hotkey = ctx.hotkey
```

### 日志系统

```ts
// 记录日志
ctx.logger.debug('Debug message')
ctx.logger.info('Info message')
ctx.logger.warn('Warning message')
ctx.logger.error('Error message')
```

### 事件系统

插件上下文提供了两个事件系统：全局事件系统 `event` 和插件专用事件系统 `pluginEvent`。

```ts
// 全局事件系统
// 订阅事件
ctx.event.on('eventName', (data) => {
  // 处理事件
})

// 取消事件订阅
ctx.event.off('eventName')

// 触发事件
ctx.event.emit('eventName', eventData)

// 插件专用事件系统
// 使用插件名作为事件前缀
ctx.pluginEvent.emit('dataChanged', { value: 100 })
ctx.pluginEvent.on('dataChanged', (data) => {
  console.log('Plugin event received:', data)
})
```

### 数据共享

```ts
// 存储共享数据
ctx.set('key', value)

// 获取共享数据
const value = ctx.get('key')

// 删除共享数据
ctx.delete('key')
```

## 核心类扩展

`extend` 方法允许你扩展以下核心类：

### 设计器相关类

- **Designer**: 设计器主类
- **Dragon**: 拖拽管理
- **Detecting**: 检测管理
- **Selection**: 选区管理
- **DropLocation**: 放置位置
- **OffsetObserver**: 偏移观察器

### 模拟器相关类

- **Simulator**: 模拟器主类
- **Viewport**: 视口管理

### 项目相关类

- **Project**: 项目管理
- **Document**: 文档管理
- **History**: 历史记录
- **Node**: 节点
- **NodeChildren**: 节点子元素
- **Props**: 属性集合
- **Prop**: 单个属性

### 组件相关类

- **ComponentMetaManager**: 组件元数据管理器
- **SetterManager**: 设置器管理器
- **ComponentMeta**: 组件元数据


## 类型扩展

利用 `declare` 的类型扩展机制，扩展和自定义核心类型定义。以下是一个示例，展示如何扩展 NodeSchema 接口:

```ts
declare module '@easy-editor/core' {
  interface NodeSchema {
    /**
     * 是否是根节点
     */
    isRoot?: boolean

    /**
     * 是否是分组
     */
    isGroup?: boolean

    /**
     * dashboard 额外信息
     */
    $dashboard?: {
      /**
       * 位置信息
       */
      rect?: DashboardRect
    }
  }
}
```

## 注册选项

在注册插件时，可以提供额外的选项：

### `autoInit` (可选)

是否自动初始化插件。如果设为 `true`，则在注册插件后立即初始化，而不等待插件管理器统一初始化所有插件。

```ts
// 注册并立即初始化插件
await pluginManager.register(MyPlugin(), { autoInit: true })
```

### `override` (可选)

是否允许覆盖同名插件。如果设为 `true`，则当注册的插件与已存在的插件同名时，会先销毁已存在的插件，然后注册新插件。

```ts
// 注册并覆盖同名插件
await pluginManager.register(MyPlugin(), { override: true })
```
