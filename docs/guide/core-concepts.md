# 核心概念

## 引擎架构

EasyEditor 采用模块化的架构设计，主要包含以下核心模块：

### 编辑器引擎 (Editor)

编辑器引擎是整个系统的核心，负责协调各个模块的工作：

```typescript
interface EditorConfig {
  /**
   * 插件 Plugin
   */
  plugins?: Plugin[]

  /**
   * 设置器 Setter
   */
  setters?: Record<string, Component | Setter>

  /**
   * 组件 Component
   */
  components?: Record<string, Component>

  /**
   * 组件元数据 ComponentMetadata
   */
  componentMetas?: Record<string, ComponentMetadata>

  /**
   * 生命周期
   */
  lifeCycles?: LifeCyclesConfig

  /**
   * designer props
   */
  designer?: Pick<DesignerProps, "onDragstart" | "onDrag" | "onDragend">

  /**
   * 默认项目 Schema
   */
  defaultSchema?: ProjectSchema

  /**
   * 快捷键
   */
  hotkeys?: HotkeyConfig[]
}
```

### 设计器 (Designer)

设计器负责页面编排和交互：

```typescript
interface Designer {
  // 编辑器实例
  readonly editor: Editor
  // 项目实例
  readonly project: Project
  // 选区管理
  readonly selection: Selection
  // 拖拽管理
  readonly dragon: Dragon

  // 获取当前文档
  get currentDocument(): Document | undefined
  // 获取当前历史记录
  get currentHistory(): History | undefined
  // 导出 Schema
  get schema(): ProjectSchema
  // 设置 Schema
  setSchema(schema: ProjectSchema): void
  // ...
}
```

### 项目管理 (Project)

项目管理负责文档和资源的管理：

```typescript
interface Project {
  readonly designer: Designer
  readonly documents: Document[]

  // 导入项目
  import(schema: ProjectSchema): void
  // 导出项目
  export(stage?: TRANSFORM_STAGE): ProjectSchema
  // 创建文档
  createDocument(schema?: RootSchema): Document
  // 打开文档
  open(idOrDoc?: string | Document | RootSchema): Document | null
  // ...
}
```

### 模拟器 (Simulator)

模拟器提供预览和调试能力：

```typescript
interface Simulator {
  readonly project: Project
  readonly designer: Designer
  readonly viewport: Viewport

  // 设计模式
  get designMode(): "design" | "preview" | "live"
  // 组件映射
  get components(): Record<string, Component>
  // 重新渲染
  rerender(): void
  // 构建组件映射
  buildComponentMap(components: Record<string, Component>): void
  // ...
}
```

### 插件系统 (Plugin)

插件系统提供了扩展引擎能力的机制：

```typescript
interface Plugin {
  // 插件名称
  name: string
  // 插件依赖
  deps?: string[]
  // 初始化
  init(ctx: PluginContext): Promise<void> | void
  // 销毁
  destroy?(ctx: PluginContext): Promise<void> | void
  // 扩展功能
  extend?(ctx: PluginExtend): void
}
```

## 核心功能

### 设计器 (Designer)

设计器提供了可视化编辑的能力：

- 组件拖拽
- 属性配置
- 布局调整
- 实时预览

### 项目管理 (Project)

项目管理负责文档和资源的管理：

- 文档管理
- 组件管理
- 配置管理
- 历史记录

### 模拟器 (Simulator)

模拟器提供了预览和调试能力：

- 实时预览
- 多设备适配
- 事件模拟
- 状态查看

## 扩展机制

### 渲染器扩展

支持多框架渲染：

```typescript
interface RendererProps {
  schema: Schema
  // 组件映射
  components: Record<string, Component>
  // 设计模式
  designMode?: boolean
}
```

### 插件扩展

提供完整的插件开发能力：

```typescript
const ExamplePlugin: Plugin = ctx => ({
  name: 'ExamplePlugin',
  // 插件依赖
  deps?: string[],
  init(ctx) {
    // 插件初始化逻辑
    ctx.logger.log('plugin initialized')
  },
  extend({ extend }) {
    // 扩展现有功能
    extend('Designer', {
      // 扩展方法
    })
  }
})
```

### 设置器扩展

自定义组件配置面板：

```typescript
interface Setter {
  // 设置器名称
  name: string
  // 设置器类型
  type: string
  // 设置器属性
  props?: Record<string, any>
}
```

## 工作流程

```typescript
// 1. 创建编辑器实例
const editor = createEasyEditor({
  plugins: [DashboardPlugin()],
  setters,
  components,
  componentMetas
})

// 2. 获取核心模块
const designer = await editor.onceGot<Designer>("designer")
const project = await editor.onceGot<Project>("project")
const simulator = await editor.onceGot<Simulator>("simulator")

// 3. 渲染设计器
<SimulatorRenderer host={simulator} />
```
