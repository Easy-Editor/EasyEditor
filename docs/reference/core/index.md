# 核心 API

Engine 是 EasyEditor 的核心引擎，负责管理整个编辑器的生命周期、插件系统、事件处理和核心模块的协调。它提供了一套完整的上下文管理机制，使各个模块之间能够进行有效通信和协作。

## 概览

```ts
import {
  init,
  materials,
  plugins,
  project,
  setters,
} from '@easy-editor/core';

// 注册插件
plugins.registerPlugins([
  DashboardPlugin(),
  DataSourcePlugin(),
]);

// 构建组件元数据
materials.buildComponentMetasMap(componentMetas);

// 注册设置器
setters.registerSetter(setterMap);

// 初始化引擎
await init({
  designMode: 'design',
  appHelper: {
    utils: {
      // 自定义工具函数
    },
  },
});
```

## 核心模块

### init()

引擎初始化函数，用于启动 EasyEditor 引擎。

**类型：** `(options?: ConfigOptions) => Promise<void>`

**参数：**
- `options` - 可选的配置选项

```ts
import { init } from '@easy-editor/core'

await init({
  designMode: 'design',
  appHelper: {
    utils: {
      formatDate: (date) => date.toLocaleDateString(),
    },
  },
})
```

**配置选项：**

- `designMode` - 设计模式，可选值：`'design'` | `'preview'`
- `appHelper` - 应用助手，提供工具函数和上下文

### plugins

插件管理模块，用于注册和管理插件。

```ts
import { plugins } from '@easy-editor/core'
import DashboardPlugin from '@easy-editor/plugin-dashboard'

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
])
```

**主要方法：**

- `registerPlugins(pluginList: Plugin[])` - 注册插件列表

### materials

物料管理模块，用于管理组件物料和元数据。

```ts
import { materials } from '@easy-editor/core'

// 构建组件元数据映射
materials.buildComponentMetasMap(Object.values(componentMetaMap))

// 获取组件元数据
const buttonMeta = materials.getComponentMeta('Button')
```

**主要方法：**

- `buildComponentMetasMap(metas: ComponentMetadata[])` - 构建组件元数据映射
- `getComponentMeta(componentName: string)` - 获取指定组件的元数据
- `registerComponentMeta(meta: ComponentMetadata)` - 注册单个组件元数据

### setters

设置器管理模块，用于管理属性设置器。

```ts
import { setters } from '@easy-editor/core'

// 注册设置器
setters.registerSetter({
  StringSetter: StringSetterComponent,
  NumberSetter: NumberSetterComponent,
  BooleanSetter: BooleanSetterComponent,
})

// 获取设置器
const stringSetter = setters.getSetter('StringSetter')
```

**主要方法：**

- `registerSetter(setterMap: Record<string, Setter>)` - 注册设置器映射
- `getSetter(name: string)` - 获取指定设置器
- `getSettersMap()` - 获取所有设置器映射

### project

项目管理模块，负责文档和资源的管理。

```ts
import { project } from '@easy-editor/core'

// 获取设计器实例
const { designer } = project

// 监听模拟器就绪
project.onSimulatorReady((simulator) => {
  simulator.set('deviceStyle', {
    viewport: { width: 1920, height: 1080 }
  })

  // 加载项目数据
  project.load(projectSchema, true)
})

// 获取当前文档
const currentDocument = project.currentDocument

// 导出项目 Schema
const schema = project.exportSchema()
```

**主要属性：**

- `designer` - 设计器实例
- `simulator` - 模拟器实例
- `currentDocument` - 当前活动文档

**主要方法：**

- `onSimulatorReady(callback: (simulator: Simulator) => void)` - 监听模拟器就绪
- `load(schema: ProjectSchema, autoOpen?: boolean)` - 加载项目数据
- `exportSchema()` - 导出项目 Schema
- `openDocument(doc: DocumentModel)` - 打开指定文档
- `removeDocument(doc: DocumentModel)` - 移除文档

## Designer API

设计器是用户进行可视化编辑的核心模块，通过 `project.designer` 访问。

```ts
import { project } from '@easy-editor/core'

const { designer } = project

// 监听选择变化
designer.onEvent('selection.change', (nodeIds) => {
  console.log('选中的组件:', nodeIds)
})

// 获取当前选中的节点
const selectedNodes = designer.selection.selected

// 选中指定节点
designer.selection.select('node_id')
```

**主要属性：**

- `selection` - 选区管理器
- `dragon` - 拖拽管理器
- `currentDocument` - 当前文档
- `simulatorProps` - 模拟器属性

**事件系统：**

设计器提供了丰富的事件系统，支持监听各种编辑操作：

```ts
import { DESIGNER_EVENT } from '@easy-editor/core'

// 监听组件选择事件
designer.onEvent(DESIGNER_EVENT.SELECTION_CHANGE, (nodeIds) => {
  // 处理选择变化
})

// 监听属性变更事件
designer.onEvent(DESIGNER_EVENT.NODE_PROPS_CHANGE, ({ node, prop, newValue }) => {
  // 处理属性变化
})

// 监听拖拽事件
designer.onEvent(DESIGNER_EVENT.DRAG_END, (e) => {
  // 处理拖拽结束
})
```

## Document API

文档模型表示一个可编辑的页面，包含组件树和相关配置。

```ts
// 获取当前文档
const doc = project.currentDocument

// 根据 ID 获取节点
const node = doc.getNode('node_id')

// 获取根节点
const rootNode = doc.root

// 创建新节点
const newNode = doc.createNode({
  componentName: 'Button',
  props: {
    text: '按钮',
    type: 'primary',
  }
})

// 导出文档为 Schema
const schema = doc.export()
```

**主要方法：**

- `getNode(id: string)` - 根据 ID 获取节点
- `createNode(schema: NodeSchema, parent?: Node, index?: number)` - 创建节点
- `removeNode(node: Node)` - 删除节点
- `export()` - 导出文档 Schema
- `import(schema: DocumentSchema)` - 导入文档 Schema

## Node API

节点表示组件树中的一个组件实例。

```ts
// 获取节点
const node = doc.getNode('node_id')

// 基本信息
console.log(node.id)              // 节点 ID
console.log(node.componentName)   // 组件名称
console.log(node.title)           // 节点标题

// 层级关系
console.log(node.parent)          // 父节点
console.log(node.children)        // 子节点列表
console.log(node.index)           // 在父节点中的索引

// 属性操作
node.setPropValue('text', '新文本')  // 设置属性
const text = node.getPropValue('text')  // 获取属性

// 状态控制
node.select()                     // 选中节点
node.hover()                      // 悬停节点
node.lock(true)                   // 锁定节点
node.hide(true)                   // 隐藏节点

// 节点操作
node.remove()                     // 删除节点
const newNode = node.replaceWith(newSchema)  // 替换节点
```

**主要属性：**

- `id` - 节点唯一标识
- `componentName` - 组件名称
- `title` - 显示名称
- `parent` - 父节点
- `children` - 子节点数组
- `props` - 属性对象
- `isRoot` - 是否为根节点
- `isLocked` - 是否被锁定
- `isHidden` - 是否被隐藏

**主要方法：**

- `getPropValue(path: string)` - 获取属性值
- `setPropValue(path: string, value: any)` - 设置属性值
- `select()` - 选中节点
- `remove()` - 删除节点
- `insertBefore(newNode: Node)` - 在当前节点前插入
- `insertAfter(newNode: Node)` - 在当前节点后插入

## 类型定义

### ConfigOptions

```ts
interface ConfigOptions {
  designMode?: 'design' | 'preview'
  appHelper?: {
    utils?: Record<string, any>
    [key: string]: any
  }
}
```

### ComponentMetadata

```ts
interface ComponentMetadata {
  componentName: string
  title: string
  icon?: string
  group?: string
  priority?: number
  props: PropConfig[]
  configure?: {
    component?: {
      isContainer?: boolean
      isModal?: boolean
    }
    supports?: {
      loop?: boolean
      condition?: boolean
    }
  }
}
```

### PropConfig

```ts
interface PropConfig {
  name: string
  title: string
  setter: string | SetterConfig
  defaultValue?: any
  condition?: (target: Node) => boolean
}
```

## 事件常量

EasyEditor 提供了一系列事件常量，用于监听不同的编辑操作：

```ts
import { DESIGNER_EVENT } from '@easy-editor/core'

// 选择相关事件
DESIGNER_EVENT.SELECTION_CHANGE        // 选择变化
DESIGNER_EVENT.HOVER_CHANGE            // 悬停变化

// 节点相关事件
DESIGNER_EVENT.NODE_CHILDREN_CHANGE    // 子节点变化
DESIGNER_EVENT.NODE_PROPS_CHANGE       // 属性变化
DESIGNER_EVENT.NODE_VISIBLE_CHANGE     // 可见性变化

// 拖拽相关事件
DESIGNER_EVENT.DRAG_START              // 拖拽开始
DESIGNER_EVENT.DRAG_END                // 拖拽结束
```

使用这些常量可以确保事件名称的正确性，并获得更好的 TypeScript 支持。
