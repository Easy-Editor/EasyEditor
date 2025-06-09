---
title: Renderer Customization
description: Creating custom renderers for EasyEditor
---

# Renderer Customization

::: warning English Documentation Status
This English documentation is currently under development. The content may be incomplete or subject to change. For the most complete and up-to-date information, please refer to the Chinese documentation. We appreciate your patience as we work to provide comprehensive English documentation.
:::

# Custom Renderer Development

EasyEditor provides a flexible renderer architecture that allows developers to create custom renderers to support different frameworks or specific scenario requirements. This guide will walk you through how to develop custom renderers.

## Renderer Architecture Overview

### Working Principle

In EasyEditor, renderers are responsible for converting Schema into actual UI interfaces. Renderers follow this workflow:

1. **Parse Schema** - Parse JSON descriptions into internal data structures
2. **Map Components** - Map component names to actual component implementations
3. **Process Properties** - Handle component properties such as event binding, style computation, etc.
4. **Render Components** - Render components to the DOM

### Architecture Composition

The renderer architecture is a layered structure that starts with Schema, processes it through the rendering adapter, and then distributes it to different renderer collections. The renderer collection contains three types: base renderer, page renderer, and component renderer. The base renderer is enhanced through higher-order components (including component wrappers and leaf node wrappers), while page renderers and component renderers interact directly with the final rendering engine. The final rendering engine renders components from the component library into user interfaces.

The rendering flow is as follows:
1. Schema data first enters the rendering adapter
2. The rendering adapter distributes data to the appropriate renderer (base renderer, page renderer, or component renderer)
3. The base renderer is enhanced through higher-order components and then passed to the final rendering engine
4. Page renderers and component renderers directly pass processed data to the final rendering engine
5. The final rendering engine renders components from the component library into user interfaces

## Base Renderer Development

### Understanding the Renderer Factory Pattern

EasyEditor's renderers use the factory pattern design, which mainly includes the following parts:

- **Renderer Factory (rendererFactory)**: Creates the final renderer component
- **Base Renderer Factory (baseRendererFactory)**: Creates basic rendering capabilities
- **Page Renderer Factory (pageRendererFactory)**: Creates page renderers based on base renderers
- **Component Renderer Factory (componentRendererFactory)**: Creates component renderers based on base renderers

These factory functions work together to build a complete rendering system:

```tsx
import {
  adapter,
  rendererFactory,
  componentRendererFactory,
  pageRendererFactory,
  baseRendererFactory
} from '@easy-editor/react-renderer'

// Custom base renderer factory
export const customBaseRendererFactory = () => {
  // Get original base renderer
  const OriginBase = baseRendererFactory();

  // Return extended base renderer class
  return class BaseRenderer extends OriginBase {
    // Custom component higher-order component chain
    get __componentHOCs() {
      if (this.__designModeIsDesign) {
        // HOC chain in design mode
        return [customWrapper, leafWrapper, compWrapper];
      }
      // HOC chain in runtime mode
      return [customWrapper, compWrapper];
    }
  }
}

// Register to adapter
adapter.setBaseRenderer(customBaseRendererFactory());

// Register page renderer and component renderer
adapter.setRenderers({
  PageRenderer: pageRendererFactory(),  // Use default page renderer
  ComponentRenderer: componentRendererFactory(),  // Use default component renderer
});

// Create final renderer
export const CustomRenderer = rendererFactory();
```

### Relationship Between Base Renderer, Page Renderer, and Component Renderer

The Base Renderer provides core rendering capabilities, including:
- Property parsing and transformation
- Component tree traversal
- Lifecycle management
- Higher-order component processing

Page Renderer (PageRenderer) and Component Renderer (ComponentRenderer) both inherit from the base renderer and are used to handle specific types of Schema:

```tsx
// Page renderer factory
export function pageRendererFactory(): BaseRenderComponent {
  // Get base renderer
  const BaseRenderer = baseRendererFactory()

  // Extend base renderer, add page-specific logic
  return class PageRenderer extends BaseRenderer {
    static displayName = 'PageRenderer'
    __namespace = 'page'

    // Page renderer specific initialization logic
    __afterInit(props: BaseRendererProps, ...rest: unknown[]) {
      const schema = props.__schema || {}
      this.state = this.__parseData(schema.state || {})
      this.__initDataSource(props)
      this.__executeLifeCycleMethod('constructor', [props, ...rest])
    }

    // Page renderer specific rendering logic
    render() {
      const { __schema } = this.props
      // Page-specific rendering logic
      // ...

      // Get component view
      const Comp = this.__getComponentView()

      // Render component
      return this.__renderComp(Comp, { pageContext: this })
    }
  }
}

// Component renderer factory
export function componentRendererFactory(): BaseRenderComponent {
  // Get base renderer
  const BaseRenderer = baseRendererFactory()

  // Extend base renderer, add component-specific logic
  return class CompRenderer extends BaseRenderer {
    static displayName = 'CompRenderer'
    __namespace = 'component'

    // Component renderer specific initialization logic
    __afterInit(props: BaseRendererProps, ...rest: any[]) {
      this.__generateCtx({
        component: this,
      })
      const schema = props.__schema || {}
      this.state = this.__parseData(schema.state || {})
      this.__initDataSource(props)
      this.__executeLifeCycleMethod('constructor', [props, ...rest])
    }

    // Component renderer specific rendering logic
    render() {
      // Component-specific rendering logic
      // ...

      const Comp = this.__getComponentView()

      // Render component
      return this.__renderComp(Comp, { compContext: this })
    }
  }
}
```

### Main Renderer Implementation

The main renderer is created through rendererFactory and is responsible for coordinating different types of renderers:

```tsx
export function rendererFactory(): RenderComponent {
  // Get registered renderers
  const RENDERER_COMPS = adapter.getRenderers()

  // Return renderer class
  return class Renderer extends Component<RendererProps> {
    static displayName = 'Renderer'

    // Rendering logic
    render() {
      const { schema, designMode, appHelper, components } = this.props

      // Merge components
      const allComponents = { ...components, ...RENDERER_COMPS }

      // Select appropriate renderer (use PageRenderer by default)
      const Comp = allComponents.PageRenderer

      // Create rendering context
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

## Advanced Renderer Features

### Custom Component Wrapper (HOC)

Base renderers process components through higher-order component chains, and you can customize these wrappers:

```tsx
import { type ComponentHocInfo, createForwardRefHocElement } from '@easy-editor/react-renderer'
import React, { Component } from 'react'

export function customWrapper(Comp: any, { schema, baseRenderer, componentInfo }: ComponentHocInfo) {
  // Get context information
  const host = baseRenderer.props?.__host
  const isDesignMode = host?.designMode === 'design'

  // Define wrapper component class
  class Wrapper extends Component<any> {
    render() {
      const { forwardRef, children, className, ...rest } = this.props

      // Handle special cases
      if (schema.isRoot) {
        return (
          <Comp ref={forwardRef} {...rest}>
            {children}
          </Comp>
        )
      }

      // Regular component rendering logic
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

  // Set display name
  (Wrapper as any).displayName = Comp.displayName

  // Create forward ref HOC element
  return createForwardRefHocElement(Wrapper, Comp)
}
```

### Error Boundary Handling

To improve renderer robustness, we can add error boundaries:

```tsx
// Error boundary component
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
          <h3>Component Rendering Error</h3>
          <p>Component: {this.props.componentName}</p>
          <p>Error: {this.state.error?.message}</p>
        </div>
      );
    }

    return this.props.children;
  }
}

// Use error boundary when rendering components
function renderComponent(
  schema: Schema,
  components: Record<string, React.ComponentType<any>>,
  context: any
) {
  const { componentName } = schema;
  // ...other code

  return (
    <ErrorBoundary componentName={componentName}>
      {/* Component rendering code */}
    </ErrorBoundary>
  );
}
```

### Component Communication Mechanism

Implement inter-component communication mechanism:

```tsx
// Create event bus
class EventBus {
  private listeners: Record<string, Array<(...args: any[]) => void>> = {};

  // Subscribe to events
  on(event: string, callback: (...args: any[]) => void) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    return () => this.off(event, callback);
  }

  // Unsubscribe
  off(event: string, callback: (...args: any[]) => void) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  // Emit events
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

// Create context
const createRendererContext = () => {
  const eventBus = new EventBus();

  return {
    // Event system
    event: {
      on: eventBus.on.bind(eventBus),
      off: eventBus.off.bind(eventBus),
      emit: eventBus.emit.bind(eventBus)
    },
    // Shared state
    shared: new Map(),
    // Set/get shared state
    setShared: (key: string, value: any) => {
      context.shared.set(key, value);
      eventBus.emit(`shared:${key}:change`, value);
    },
    getShared: (key: string) => context.shared.get(key)
  };
};
```

## Specific Scenario Renderer Cases

### Dashboard Renderer Implementation

The following is a dashboard renderer implementation case, showing how to extend scenario-specific renderers based on the basic architecture:

```tsx
import { useRef } from 'react'
import { adapter, componentRendererFactory, pageRendererFactory, rendererFactory } from '@easy-editor/react-renderer'
import { useResizeObserver } from '../hooks/useResizeObserver'

// 1. Custom dashboard base renderer
const dashboardBaseRendererFactory = () => {
  // Get original base renderer
  const BaseRenderer = baseRendererFactory();

  return class DashboardBaseRenderer extends BaseRenderer {
    // Custom component higher-order component chain, add dashboard-specific wrappers
    get __componentHOCs() {
      if (this.__designModeIsDesign) {
        // HOC chain in design mode
        return [dashboardWrapper, leafWrapper, compWrapper];
      }
      // HOC chain in runtime mode
      return [dashboardWrapper, compWrapper];
    }
  }
}

// 2. Register dashboard renderer
adapter.setBaseRenderer(dashboardBaseRendererFactory());
adapter.setRenderers({
  PageRenderer: pageRendererFactory(),
  ComponentRenderer: componentRendererFactory(),
});

// 3. Create dashboard renderer
const DashboardRenderer = rendererFactory();

// 4. Wrap dashboard renderer, handle scaling and other special logic
const DashboardRendererWrapper = (props) => {
  const { viewport, ...rendererProps } = props
  const { width: viewportWidth = 1920, height: viewportHeight = 1080 } = viewport || {}

  // Reference DOM elements
  const canvasRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  // Listen for canvas size changes, automatically adjust scale ratio
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
      {/* Canvas container */}
      <div ref={canvasRef} className='easy-editor-canvas'>
        {/* Viewport container */}
        <div
          ref={viewportRef}
          className='easy-editor-viewport'
          style={{
            width: viewportWidth,
            height: viewportHeight,
          }}
        >
          {/* Content area */}
          <div className='easy-editor-content'>
            {/* Use customized dashboard renderer */}
            <DashboardRenderer {...rendererProps} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default DashboardRendererWrapper
```

### Dashboard Component Wrapper Implementation

Components in dashboard scenarios require special positioning and coordinate system handling:

```tsx
import type { NodeSchema } from '@easy-editor/core'
import { type ComponentHocInfo, createForwardRefHocElement } from '@easy-editor/react-renderer'
import { Component } from 'react'

export function dashboardWrapper(Comp: any, { schema, baseRenderer }: ComponentHocInfo) {
  // Get context information
  const host = baseRenderer.props?.__host
  const isDesignMode = host?.designMode === 'design'
  // Dashboard configuration information
  let { mask = true } = host?.dashboardStyle || {}

  // In non-design mode, don't show mask
  if (!isDesignMode) {
    mask = false
  }

  class Wrapper extends Component<any> {
    render() {
      const { forwardRef, children, className, ...rest } = this.props
      // Calculate node position and size
      const rect = computeRect(schema)

      if (!rect) {
        return null
      }

      // Special handling for root nodes
      if (schema.isRoot) {
        return (
          <Comp ref={forwardRef} {...rest}>
            {children}
          </Comp>
        )
      }

      // Regular node rendering, including coordinate positioning
      return (
        // Container layer
        <div
          className={`easy-editor-component-container ${mask ? 'mask' : ''}`}
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          }}
        >
          {/* Reset coordinate system */}
          <div
            style={{
              position: 'absolute',
              left: -rect.x!,
              top: -rect.y!,
            }}
          >
            {/* Component coordinate positioning */}
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
              {/* Component rendering */}
              <Comp className={`easy-editor-component ${mask ? 'mask' : ''} ${className || ''}`} {...rest}>
                {children && (
                  // Reset coordinate system again for internal component positioning
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

## Adapting Other Frameworks

:::warning Under Development
Support for adapting other frameworks (such as Vue, Angular, etc.) is actively under development. We plan to provide support for more frameworks in future versions, allowing EasyEditor to better serve projects with different technology stacks.

If you have specific framework adaptation needs, please submit an Issue on GitHub or participate in discussions.
:::

## Tips
::: tip Tips
EasyEditor provides a highly flexible and extensible renderer architecture that allows you to build customized rendering solutions that fully meet project requirements. The above implementations are for reference only, and you can freely develop according to actual scenarios to create your own renderers.
:::
