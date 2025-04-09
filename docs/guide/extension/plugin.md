# 插件扩展

插件是 EasyEditor 的功能扩展机制，通过插件可以扩展编辑器的功能，增强核心能力。本指南将帮助你了解如何开发和集成自定义插件。

## 插件介绍

插件是 EasyEditor 的扩展单元，用于增强编辑器的功能。插件可以：

- 添加新功能
- 扩展现有类的方法和属性
- 监听和响应编辑器事件
- 与其他插件协作

## 插件结构

一个完整的插件只需要一个文件：

```bash
my-plugin/
├── index.ts      # 插件实现
```

## 插件开发

### 1. 基础插件

```typescript
import type { Plugin } from '@easy-editor/core'

const MyPlugin: Plugin = ctx => {
  return {
    name: 'MyPlugin',
    deps: [],  // 依赖的其他插件
    init() {
      ctx.logger.log('MyPlugin initialized')

      ctx.project.set('myPlugin', {
        data: 'value'
      })
    },
  }
}

export default MyPlugin
```

### 2. 注册插件

在编辑器初始化时注册插件：

```typescript
import { createEasyEditor } from '@easy-editor/core'
import MyPlugin from './plugins/my-plugin'

const editor = createEasyEditor({
  // ...其他配置
  plugins: [
    MyPlugin()
  ]
})
```

### 3. 功能扩展插件

下面是一个扩展现有功能的插件示例：

```typescript
import type { Plugin, PluginExtend } from '@easy-editor/core'

const ExtendPlugin: Plugin = ctx => {
  return {
    name: 'ExtendPlugin',
    deps: [],
    init() {
      ctx.logger.log('ExtendPlugin initialized')
    },
    // 扩展核心类
    extend({ extendClass, extend }) {
      const { Node } = extendClass

      // 扩展 Node 类
      extend('Node', {
        // 添加自定义方法
        customMethod: {
          value(this: Node) {
            return 'Custom method result'
          }
        },
        // 添加自定义属性
        customProperty: {
          get(this: Node) {
            return this.getExtraPropValue('customProp')
          }
        }
      })
    }
  }
}

export default ExtendPlugin
```

## 插件配置项

### 核心属性

#### `name` (必需)

定义插件的唯一名称，用于识别插件和处理依赖关系。

```typescript
{
  name: 'MyPlugin'
}
```

#### `deps` (可选)

定义插件依赖的其他插件列表。EasyEditor 会确保依赖的插件在当前插件之前加载和初始化。

```typescript
{
  deps: ['PluginA', 'PluginB']  // 依赖 PluginA 和 PluginB
}
```

#### `eventPrefix` (可选)

定义插件的事件前缀，用于区分不同插件的事件。如果不设置，则使用 'common' 作为前缀。

```typescript
{
  eventPrefix: 'my-plugin'
}
```

### 核心方法

#### `init` (必需)

插件初始化方法，在编辑器启动时执行。可以是同步或异步函数。

```typescript
{
  init(ctx) {
    // 初始化逻辑
    ctx.logger.log('Plugin initialized')

    // 订阅事件
    ctx.event.on('event-name', (data) => {
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

```typescript
{
  destroy(ctx) {
    // 清理资源
    ctx.logger.log('Plugin destroyed')

    // 取消事件订阅
    ctx.event.off('event-name')
  }
}
```

#### `extend` (可选)

扩展编辑器核心类的方法，可以添加新的方法或属性，修改现有行为。

```typescript
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
          return 'Custom property value'
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

## 插件上下文 (Context)

插件上下文 `ctx` 是一个包含编辑器核心功能的对象，它提供了访问和操作编辑器各个部分的能力。通过 `ctx` 你可以访问编辑器的日志系统、事件系统、项目管理等核心功能。详细的 API 文档请参考 [插件上下文 API]()。


## 注册选项

在注册插件时，可以提供额外的选项：

### `autoInit` (可选)

是否自动初始化插件。如果设为 `true`，则在注册插件后立即初始化，而不等待插件管理器统一初始化所有插件。

```typescript
// 注册并立即初始化插件
await pluginManager.register(MyPlugin, { autoInit: true })
```

### `override` (可选)

是否允许覆盖同名插件。如果设为 `true`，则当注册的插件与已存在的插件同名时，会先销毁已存在的插件，然后注册新插件。

```typescript
// 注册并覆盖同名插件
await pluginManager.register(MyPlugin, { override: true })
```

## 下一步

- 了解更多[插件配置选项](/api/plugin-api)
- 探索[高级插件开发](/guide/advanced-plugin)
- 查看[插件最佳实践](/guide/plugin-best-practices)
