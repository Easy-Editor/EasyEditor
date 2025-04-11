# 渲染器定制

EasyEditor 提供了灵活的渲染器定制能力，允许开发者根据具体需求扩展和定制渲染器。本文档将介绍渲染器的内部实现原理和扩展机制。

## 渲染器基础

### 核心概念

EasyEditor 的渲染器系统基于以下核心概念：

1. **渲染器类型**
   - 运行态渲染器（Runtime Renderer）：用于生产环境
   - 设计态渲染器（Design Renderer）：用于开发环境

2. **渲染器职责**
   - 组件渲染
   - 状态管理
   - 事件处理
   - 数据绑定

### 内部实现

#### 渲染器核心

`react-renderer` 包提供了渲染器的核心实现，主要通过基础渲染器工厂方法创建渲染器实例：

```typescript
// packages/react-renderer/src/renderer-core/base.tsx
export function baseRendererFactory(): BaseRenderComponent {
  const { BaseRenderer: customBaseRenderer } = adapter.getRenderers()

  if (customBaseRenderer) {
    return customBaseRenderer as unknown as BaseRenderComponent
  }

  return class BaseRenderer extends Component<BaseRendererProps, BaseRendererProps> {
    // 核心渲染逻辑
    __createVirtualDom = (
      originalSchema: NodeData | NodeData[] | undefined,
      originalScope: any,
      parentInfo: NodeInfo,
      idx: string | number = '',
    ): any => {
      // Schema 处理逻辑
      // ...
    }

    // 组件属性处理
    __parseProps = (originalProps: any, scope: any, path: string, info: NodeInfo): any => {
      // 处理属性
      // ...
    }

    // 子节点处理
    __getSchemaChildrenVirtualDom = (schema: NodeSchema | undefined, scope: any, Comp: any, condition = true) => {
      // 处理子节点
      // ...
    }

    // 组件实例化
    __getHOCWrappedComponent(
      OriginalComp: any,
      info: {
        schema: ComponentHocInfo['schema']
        scope: ComponentHocInfo['scope']
        componentInfo?: ComponentHocInfo['componentInfo']
        baseRenderer?: ComponentHocInfo['baseRenderer']
      },
    ) {
      // HOC 包装组件
      // ...
    }
  }
}
```

#### 渲染器工厂方法

EasyEditor 使用工厂模式创建渲染器，可以自定义渲染器行为：

```typescript
// packages/react-renderer/src/renderer-core/renderer.tsx
export function rendererFactory() {
  const { PageRenderer, ComponentRenderer } = adapter.getRenderers()

  return (props: RendererProps) => {
    const { schema, rendererName, ...restProps } = props
    if (isPage(schema)) {
      const renderer = rendererName || 'PageRenderer'
      return createElement(PageRenderer || pageRendererFactory() as any, {
        ...restProps,
        schema,
        __schema: schema,
      })
    }
    return createElement(ComponentRenderer || componentRendererFactory() as any, {
      ...restProps,
      schema,
      __schema: schema,
    })
  }
}
```

#### Schema 处理

渲染器的核心是处理 Schema 并转换为 React 组件：

```typescript
// packages/react-renderer/src/renderer-core/base.tsx (部分实现)
__createVirtualDom = (
  originalSchema: NodeData | NodeData[] | undefined,
  originalScope: any,
  parentInfo: NodeInfo,
  idx: string | number = '',
): any => {
  if (!originalSchema) {
    return null
  }

  // 处理 Schema 数组
  if (Array.isArray(originalSchema)) {
    return originalSchema.map((item, i) => {
      return this.__createVirtualDom(item, originalScope, parentInfo, i)
    })
  }

  // 获取组件信息
  const schema = originalSchema as NodeSchema
  const { componentName } = schema

  // 获取组件
  const Component = this.__getComponent(componentName)

  // 处理组件属性
  const props = this.__parseProps(schema.props, originalScope, '${path}.props', info)

  // 处理子节点
  const children = this.__getSchemaChildrenVirtualDom(schema, originalScope, Component)

  // 创建组件实例
  return this.__getHOCWrappedComponent(Component, {
    schema,
    scope: originalScope,
    componentInfo: {
      props,
      compRef: this.__getRef,
    },
    baseRenderer: this,
  })
}
```

## 渲染器扩展

### 扩展机制

渲染器通过继承基础渲染器进行扩展，如 `react-renderer-dashboard` 的实现：

```typescript
// packages/react-renderer-dashboard/src/renderer-core/renderer/base.ts
export const dashboardBaseRendererFactory: () => any = () => {
  const OriginBase = baseRendererFactory()

  return class BaseRenderer extends OriginBase {
    // 扩展 HOC 处理
    get __componentHOCs(): ComponentConstruct[] {
      if (this.__designModeIsDesign) {
        return [dashboardWrapper, leafWrapper, compWrapper]
      }
      return [dashboardWrapper, compWrapper]
    }
  }
}
```

### HOC 扩展

通过 HOC 可以扩展组件的渲染行为，如大屏组件的布局控制：

```typescript
// packages/react-renderer-dashboard/src/renderer-core/hoc/dashboard.tsx
export function dashboardWrapper(Comp: any, { schema, baseRenderer }: ComponentHocInfo) {
  // 获取设计模式
  const host = baseRenderer.props?.__host
  const isDesignMode = host?.designMode === 'design'

  // 处理大屏样式
  let { mask = true } = host?.dashboardStyle || {}
  if (!isDesignMode) {
    mask = false
  }

  class Wrapper extends Component<any> {
    render() {
      const { forwardRef, children, ...rest } = this.props
      const rect = computeRect(schema)

      // 应用位置和尺寸
      return (
        <div
          className={`easy-editor-component-container ${mask ? 'mask' : ''}`}
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          }}
        >
          {/* 组件渲染 */}
          <Comp {...rest}>{children}</Comp>
        </div>
      )
    }
  }

  return createForwardRefHocElement(Wrapper, Comp)
}
```

## 设计态与运行态

### 运行态渲染器实现

运行态渲染器专注于高效渲染，不包含设计态功能：

```typescript
// packages/react-renderer-dashboard/src/renderer-core/renderer.ts
import { adapter, componentRendererFactory, pageRendererFactory, rendererFactory } from '@easy-editor/react-renderer'
import { dashboardBaseRendererFactory } from './renderer/base'

// 设置基础渲染器
adapter.setBaseRenderer(dashboardBaseRendererFactory())
adapter.setRenderers({
  PageRenderer: pageRendererFactory(),
  ComponentRenderer: componentRendererFactory(),
})

// 导出运行态渲染器
export const LowCodeRenderer = rendererFactory()
```

### 设计态渲染器实现

设计态渲染器与模拟器集成，支持拖拽、选择等交互功能：

```typescript
// packages/react-renderer-dashboard/src/simulator-renderer/RendererView.tsx (部分实现)
export const Renderer = observer(
  class Renderer extends Component<{
    documentInstance: DocumentInstance
    simulatorRenderer: SimulatorRendererContainer
  }> {
    render() {
      const { documentInstance, simulatorRenderer: renderer } = this.props
      const { host } = renderer
      const { container } = documentInstance
      const { designMode, device } = container

      return (
        <LowCodeRenderer
          schema={documentInstance.schema}
          components={container.components}
          appHelper={container.context}
          designMode={designMode}
          device={device}
          documentId={document.id}
          getNode={(id: string) => documentInstance.getNode(id)!}
          __host={host} // 传递 host 以支持设计态功能
          __container={container}
          onCompGetRef={(schema: any, ref: ReactInstance | null) => {
            // 组件引用处理
            documentInstance.mountInstance(schema.id, ref)
          }}
        />
      )
    }
  },
)
```

### 模拟器与渲染器交互

模拟器负责管理设计态环境，通过 `SimulatorRenderer` 与渲染器通信：

```typescript
// packages/react-renderer-dashboard/src/simulator-renderer/simulator-renderer.ts (部分实现)
export class SimulatorRendererContainer implements ISimulatorRenderer {
  host: Simulator

  // 挂载到模拟器
  mount(host: Simulator) {
    this.host = host
    this.init()
  }

  // 初始化模拟器环境
  init() {
    this.autoRender = this.host.autoRender

    // 连接模拟器
    this.disposeFunctions.push(
      this.host.connect(this, () => {
        runInAction(() => {
          // 同步配置
          this._layout = this.host.project.get('config')?.layout

          // 同步组件
          if (this._componentsMap !== this.host.designer.componentMetaManager.componentsMap) {
            this._componentsMap = this.host.designer.componentMetaManager.componentsMap
            this.buildComponents()
          }

          // 同步设计模式
          this._designMode = this.host.designMode
        })
      }),
    )
  }

  // 构建组件映射关系
  private buildComponents() {
    this._components = buildComponents(this._libraryMap, this._componentsMap)
  }
}
```

## 总结

EasyEditor 的渲染器系统提供了灵活的扩展机制：

1. 通过基础渲染器工厂方法提供核心渲染逻辑
2. 使用 HOC 模式扩展组件渲染行为
3. 提供运行态和设计态两种渲染模式
4. 支持通过 Adapter 适配不同的渲染实现

通过这些机制，开发者可以灵活定制渲染器，满足各种场景需求。

## 下一步

- [渲染器 API 文档](docs/api/renderer.md)
- [插件开发指南](docs/guide/plugin.md)
- [设计态渲染器文档](docs/guide/renderer/editor.md)
