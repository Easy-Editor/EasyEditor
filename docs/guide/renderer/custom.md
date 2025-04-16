# 自定义渲染器开发

EasyEditor 提供了灵活的渲染器架构，允许开发者创建自定义渲染器以支持不同的框架或特定场景需求。本文将指导你如何开发自定义渲染器。

## 渲染器架构概述

### 工作原理

在 EasyEditor 中，渲染器负责将 Schema 转换为实际的 UI 界面。渲染器遵循以下工作流程：

1. **解析 Schema** - 将 JSON 描述解析为内部数据结构
2. **映射组件** - 将组件名称映射到实际组件实现
3. **属性处理** - 处理组件属性，如事件绑定、样式计算等
4. **渲染组件** - 将组件渲染到 DOM 中

### 架构组成

渲染器架构是一个分层结构，从 Schema 开始，经过渲染适配器处理后，分发到不同的渲染器集合中。渲染器集合包含基础渲染器、页面渲染器和组件渲染器三种类型。基础渲染器通过高阶组件（包括组件包装器和叶子节点包装器）进行增强，而页面渲染器和组件渲染器则直接与最终渲染引擎交互。最终渲染引擎将组件库中的组件渲染成用户界面。

渲染流程如下：
1. Schema 数据首先进入渲染适配器
2. 渲染适配器将数据分发到相应的渲染器（基础渲染器、页面渲染器或组件渲染器）
3. 基础渲染器通过高阶组件进行增强，然后传递给最终渲染引擎
4. 页面渲染器和组件渲染器直接将处理后的数据传递给最终渲染引擎
5. 最终渲染引擎将组件库中的组件渲染成用户界面

## 基础渲染器开发

### 理解渲染器工厂模式

EasyEditor 的渲染器采用工厂模式设计，主要包含以下几个部分：

- **渲染器工厂（rendererFactory）**：创建最终的渲染器组件
- **基础渲染器工厂（baseRendererFactory）**：创建基础渲染能力
- **页面渲染器工厂（pageRendererFactory）**：基于基础渲染器创建页面渲染器
- **组件渲染器工厂（componentRendererFactory）**：基于基础渲染器创建组件渲染器

这些工厂函数协同工作，构建完整的渲染体系：

```tsx
import {
  adapter,
  rendererFactory,
  componentRendererFactory,
  pageRendererFactory,
  baseRendererFactory
} from '@easy-editor/react-renderer'

// 自定义基础渲染器工厂
export const customBaseRendererFactory = () => {
  // 获取原始基础渲染器
  const OriginBase = baseRendererFactory();

  // 返回扩展后的基础渲染器类
  return class BaseRenderer extends OriginBase {
    // 自定义组件高阶组件链
    get __componentHOCs() {
      if (this.__designModeIsDesign) {
        // 设计模式下的 HOC 链
        return [customWrapper, leafWrapper, compWrapper];
      }
      // 运行模式下的 HOC 链
      return [customWrapper, compWrapper];
    }
  }
}

// 注册到适配器
adapter.setBaseRenderer(customBaseRendererFactory());

// 注册页面渲染器和组件渲染器
adapter.setRenderers({
  PageRenderer: pageRendererFactory(),  // 使用默认的页面渲染器
  ComponentRenderer: componentRendererFactory(),  // 使用默认的组件渲染器
});

// 创建最终渲染器
export const CustomRenderer = rendererFactory();
```

### 基础渲染器、页面渲染器和组件渲染器的关系

基础渲染器（BaseRenderer）提供核心渲染能力，包括：
- 属性解析与转换
- 组件树遍历
- 生命周期管理
- 高阶组件处理

页面渲染器（PageRenderer）和组件渲染器（ComponentRenderer）都继承自基础渲染器，用于处理特定类型的 Schema：

```tsx
// 页面渲染器工厂
export function pageRendererFactory(): BaseRenderComponent {
  // 获取基础渲染器
  const BaseRenderer = baseRendererFactory()

  // 扩展基础渲染器，添加页面特有逻辑
  return class PageRenderer extends BaseRenderer {
    static displayName = 'PageRenderer'
    __namespace = 'page'

    // 页面渲染器特有的初始化逻辑
    __afterInit(props: BaseRendererProps, ...rest: unknown[]) {
      const schema = props.__schema || {}
      this.state = this.__parseData(schema.state || {})
      this.__initDataSource(props)
      this.__executeLifeCycleMethod('constructor', [props, ...rest])
    }

    // 页面渲染器特有的渲染逻辑
    render() {
      const { __schema } = this.props
      // 页面特有的渲染逻辑
      // ...

      // 获取组件视图
      const Comp = this.__getComponentView()

      // 渲染组件
      return this.__renderComp(Comp, { pageContext: this })
    }
  }
}

// 组件渲染器工厂
export function componentRendererFactory(): BaseRenderComponent {
  // 获取基础渲染器
  const BaseRenderer = baseRendererFactory()

  // 扩展基础渲染器，添加组件特有逻辑
  return class CompRenderer extends BaseRenderer {
    static displayName = 'CompRenderer'
    __namespace = 'component'

    // 组件渲染器特有的初始化逻辑
    __afterInit(props: BaseRendererProps, ...rest: any[]) {
      this.__generateCtx({
        component: this,
      })
      const schema = props.__schema || {}
      this.state = this.__parseData(schema.state || {})
      this.__initDataSource(props)
      this.__executeLifeCycleMethod('constructor', [props, ...rest])
    }

    // 组件渲染器特有的渲染逻辑
    render() {
      // 组件特有的渲染逻辑
      // ...

      const Comp = this.__getComponentView()

      // 渲染组件
      return this.__renderComp(Comp, { compContext: this })
    }
  }
}
```

### 主渲染器的实现

主渲染器通过 rendererFactory 创建，负责协调不同类型的渲染器：

```tsx
export function rendererFactory(): RenderComponent {
  // 获取已注册的渲染器
  const RENDERER_COMPS = adapter.getRenderers()

  // 返回渲染器类
  return class Renderer extends Component<RendererProps> {
    static displayName = 'Renderer'

    // 渲染逻辑
    render() {
      const { schema, designMode, appHelper, components } = this.props

      // 合并组件
      const allComponents = { ...components, ...RENDERER_COMPS }

      // 选择合适的渲染器（默认使用 PageRenderer）
      const Comp = allComponents.PageRenderer

      // 创建渲染上下文
      return (
        <RendererContext.Provider
          value={{
            appHelper,
            components: allComponents,
            engine: this,
          }}
        >
          <Comp
            __appHelper={appHelper}
            __components={allComponents}
            __schema={schema}
            __designMode={designMode}
            {...this.props}
          />
        </RendererContext.Provider>
      )
    }
  }
}
```

## 高级渲染器功能

### 自定义组件包装器 (HOC)

基础渲染器通过高阶组件链处理组件，你可以自定义这些包装器：

```tsx
import { type ComponentHocInfo, createForwardRefHocElement } from '@easy-editor/react-renderer'
import React, { Component } from 'react'

export function customWrapper(Comp: any, { schema, baseRenderer, componentInfo }: ComponentHocInfo) {
  // 获取上下文信息
  const host = baseRenderer.props?.__host
  const isDesignMode = host?.designMode === 'design'

  // 定义包装组件类
  class Wrapper extends Component<any> {
    render() {
      const { forwardRef, children, className, ...rest } = this.props

      // 处理特殊情况
      if (schema.isRoot) {
        return (
          <Comp ref={forwardRef} {...rest}>
            {children}
          </Comp>
        )
      }

      // 普通组件渲染逻辑
      return (
        <div className="custom-component-container">
          <Comp
            ref={forwardRef}
            className={`custom-component ${className || ''}`}
            {...rest}
          >
            {children}
          </Comp>
        </div>
      )
    }
  }

  // 设置显示名称
  (Wrapper as any).displayName = Comp.displayName

  // 创建转发引用的 HOC 元素
  return createForwardRefHocElement(Wrapper, Comp)
}
```

### 错误边界处理

为了提高渲染器的健壮性，我们可以添加错误边界：

```tsx
// 错误边界组件
class ErrorBoundary extends React.Component<
  { componentName: string; children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`Error rendering ${this.props.componentName}:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="easy-editor-error-boundary">
          <h3>组件渲染错误</h3>
          <p>组件: {this.props.componentName}</p>
          <p>错误: {this.state.error?.message}</p>
        </div>
      );
    }

    return this.props.children;
  }
}

// 在渲染组件时使用错误边界
function renderComponent(
  schema: Schema,
  components: Record<string, React.ComponentType<any>>,
  context: any
) {
  const { componentName } = schema;
  // ...其他代码

  return (
    <ErrorBoundary componentName={componentName}>
      {/* 渲染组件的代码 */}
    </ErrorBoundary>
  );
}
```

### 组件通信机制

实现组件间通信机制：

```tsx
// 创建事件总线
class EventBus {
  private listeners: Record<string, Array<(...args: any[]) => void>> = {};

  // 订阅事件
  on(event: string, callback: (...args: any[]) => void) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    return () => this.off(event, callback);
  }

  // 取消订阅
  off(event: string, callback: (...args: any[]) => void) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  // 触发事件
  emit(event: string, ...args: any[]) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach(callback => {
      try {
        callback(...args);
      } catch (error) {
        console.error(`Error in event listener for ${event}:`, error);
      }
    });
  }
}

// 创建上下文
const createRendererContext = () => {
  const eventBus = new EventBus();

  return {
    // 事件系统
    event: {
      on: eventBus.on.bind(eventBus),
      off: eventBus.off.bind(eventBus),
      emit: eventBus.emit.bind(eventBus)
    },
    // 共享状态
    shared: new Map(),
    // 设置/获取共享状态
    setShared: (key: string, value: any) => {
      context.shared.set(key, value);
      eventBus.emit(`shared:${key}:change`, value);
    },
    getShared: (key: string) => context.shared.get(key)
  };
};
```

## 特定场景渲染器案例

### 大屏渲染器实现

以下是大屏渲染器的实现案例，展示了如何基于基础架构扩展特定场景的渲染器：

```tsx
import { useRef } from 'react'
import { adapter, componentRendererFactory, pageRendererFactory, rendererFactory } from '@easy-editor/react-renderer'
import { useResizeObserver } from '../hooks/useResizeObserver'

// 1. 自定义大屏基础渲染器
const dashboardBaseRendererFactory = () => {
  // 获取原始基础渲染器
  const BaseRenderer = baseRendererFactory();

  return class DashboardBaseRenderer extends BaseRenderer {
    // 自定义组件高阶组件链，添加大屏特有的包装器
    get __componentHOCs() {
      if (this.__designModeIsDesign) {
        // 设计模式下的 HOC 链
        return [dashboardWrapper, leafWrapper, compWrapper];
      }
      // 运行模式下的 HOC 链
      return [dashboardWrapper, compWrapper];
    }
  }
}

// 2. 注册大屏渲染器
adapter.setBaseRenderer(dashboardBaseRendererFactory());
adapter.setRenderers({
  PageRenderer: pageRendererFactory(),
  ComponentRenderer: componentRendererFactory(),
});

// 3. 创建大屏渲染器
const DashboardRenderer = rendererFactory();

// 4. 包装大屏渲染器，处理缩放等特殊逻辑
const DashboardRendererWrapper = (props) => {
  const { viewport, ...rendererProps } = props
  const { width: viewportWidth = 1920, height: viewportHeight = 1080 } = viewport || {}

  // 引用DOM元素
  const canvasRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  // 监听画布大小变化，自动调整缩放比例
  useResizeObserver({
    elem: canvasRef,
    onResize: entries => {
      const { width, height } = entries[0].contentRect
      const ww = width / viewportWidth
      const wh = height / viewportHeight
      viewportRef.current!.style.transform = `scale(${Math.min(ww, wh)}) translate(-50%, -50%)`
    },
  })

  return (
    <div className='easy-editor'>
      {/* 画布容器 */}
      <div ref={canvasRef} className='easy-editor-canvas'>
        {/* 视口容器 */}
        <div
          ref={viewportRef}
          className='easy-editor-viewport'
          style={{
            width: viewportWidth,
            height: viewportHeight,
          }}
        >
          {/* 内容区域 */}
          <div className='easy-editor-content'>
            {/* 使用定制的大屏渲染器 */}
            <DashboardRenderer {...rendererProps} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default DashboardRendererWrapper
```

### 大屏组件包装器实现

大屏场景中的组件需要特殊的定位和坐标系处理：

```tsx
import type { NodeSchema } from '@easy-editor/core'
import { type ComponentHocInfo, createForwardRefHocElement } from '@easy-editor/react-renderer'
import { Component } from 'react'

export function dashboardWrapper(Comp: any, { schema, baseRenderer }: ComponentHocInfo) {
  // 获取上下文信息
  const host = baseRenderer.props?.__host
  const isDesignMode = host?.designMode === 'design'
  // 大屏配置信息
  let { mask = true } = host?.dashboardStyle || {}

  // 非设计模式下，不显示遮罩
  if (!isDesignMode) {
    mask = false
  }

  class Wrapper extends Component<any> {
    render() {
      const { forwardRef, children, className, ...rest } = this.props
      // 计算节点位置和尺寸
      const rect = computeRect(schema)

      if (!rect) {
        return null
      }

      // 根节点特殊处理
      if (schema.isRoot) {
        return (
          <Comp ref={forwardRef} {...rest}>
            {children}
          </Comp>
        )
      }

      // 常规节点渲染，包含坐标定位
      return (
        // 容器层
        <div
          className={`easy-editor-component-container ${mask ? 'mask' : ''}`}
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          }}
        >
          {/* 重置坐标系 */}
          <div
            style={{
              position: 'absolute',
              left: -rect.x!,
              top: -rect.y!,
            }}
          >
            {/* 组件坐标定位 */}
            <div
              ref={forwardRef}
              className='easy-editor-component-mask'
              style={{
                left: rect.x!,
                top: rect.y!,
                width: rect.width,
                height: rect.height,
              }}
            >
              {/* 组件渲染 */}
              <Comp className={`easy-editor-component ${mask ? 'mask' : ''} ${className || ''}`} {...rest}>
                {children && (
                  // 再次重置坐标系，用于内部组件定位
                  <div
                    style={{
                      position: 'absolute',
                      left: -rect.x!,
                      top: -rect.y!,
                    }}
                  >
                    {children}
                  </div>
                )}
              </Comp>
            </div>
          </div>
        </div>
      )
    }
  }
  ;(Wrapper as any).displayName = Comp.displayName

  return createForwardRefHocElement(Wrapper, Comp)
}
```

## 适配其他框架

:::warning 开发中
适配其他框架（如 Vue、Angular 等）的功能正在积极开发中。我们计划在未来版本中提供更多框架的支持，让 EasyEditor 能够更好地服务于不同技术栈的项目。

如果你有特定的框架适配需求，欢迎在 GitHub 上提交 Issue 或参与讨论。
:::

## 提示
::: tip 提示
EasyEditor 提供了高度灵活和可扩展的渲染器架构，你可以基于此构建完全符合项目需求的定制化渲染方案。上述实现仅供参考，你可以根据实际场景自由发挥，打造属于自己的渲染器。
:::
