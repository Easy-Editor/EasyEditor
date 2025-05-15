# @easy-editor/renderer-core

Renderer Core package for EasyEditor. This package provides the foundation for implementing framework-specific renderers (like React, Vue, etc.) in EasyEditor.

## Package Structure

The renderer-core provides:
- Type definitions for renderer implementations
- Utility functions for schema processing
- Core interfaces for component rendering
- Data handling and transformation helpers

## Features

- **Framework Agnostic**: Core renderer interfaces that can be implemented for any UI framework
- **Schema Processing**: Utilities for processing low-code schema structures
- **Component Model**: Type definitions for component rendering and lifecycle management
- **Data Binding**: Support for data expressions and bindings within schemas
- **DataSource Integration**: Types for handling data sources in rendered components
- **Error Handling**: Standardized error boundaries and component fallbacks

## Core Interfaces

### Renderer

The renderer is responsible for converting schema to component instances:

```typescript
export interface RendererProps {
  // The schema representing the component tree
  schema: RootSchema | NodeSchema;

  // Component implementations mapped by name
  components: Record<string, ComponentType<any>>;

  // Rendering mode (design or live)
  designMode?: DesignMode;

  // Device information for responsive rendering
  device?: 'default' | 'pc' | 'mobile' | string;

  // Reference to the Simulator host
  __host?: Simulator;

  // ... additional properties
}
```

### Component Types

The renderer-core defines several component types to handle different rendering scenarios:

```typescript
// Regular component used in rendering
export interface GeneralComponent<P = any, S = any, SS = any> {
  // Component lifecycle methods
  componentDidMount?(): void;
  componentDidUpdate?(): void;
  componentWillUnmount?(): void;

  // Rendering method
  render(): any;

  // Component state and props
  props: P;
  state: S;
  // ... additional properties
}

// Component shown when a component is not found
export interface NotFoundComponentProps {
  componentName?: string;
  // ... additional properties
}

// Component shown when rendering fails
export interface FaultComponentProps {
  componentName?: string;
  error?: Error;
  // ... additional properties
}
```

## Data Handling

The renderer-core provides utilities for handling data and expressions:

### Expression Parsing

```typescript
import { parseExpression } from '@easy-editor/renderer-core';

// Convert JSExpression objects into actual values
const result = parseExpression({
  type: 'JSExpression',
  value: '(function(){ return this.state.count + 1; })'
}, context);
```

### Data Source Types

```typescript
export interface DataSourceItem {
  id: string;
  isInit?: boolean | JSExpression;
  type?: string;
  options?: {
    uri: string | JSExpression;
    params?: JSONObject | JSExpression;
    method?: string | JSExpression;
    // ... additional options
  };
  dataHandler?: JSExpression;
}

export interface DataSource {
  list?: DataSourceItem[];
  dataHandler?: JSExpression;
}
```

