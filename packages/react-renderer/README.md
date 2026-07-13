# @easy-editor/react-renderer

React renderer implementation for EasyEditor. This package provides the React-specific implementation of the renderer-core interfaces, enabling schema-driven rendering using React components.

## Features

- **React Component Rendering**: Converts EasyEditor schema into React component hierarchy
- **React Context Integration**: Provides schema context to all rendered components
- **Lifecycle Management**: Handles React component lifecycle methods based on schema
- **Error Boundaries**: React-specific error handling with fallback components
- **Ref Forwarding**: Automatic reference collection for component manipulation
- **Dynamic Props**: Support for dynamic props and expressions within React components
- **State Management**: Integration with React's state system
- **Event Handling**: React-specific event binding from schema definitions

## Expression trust boundary

Executable schema fields are routed through the `expressionEvaluator` renderer
prop. Omitting the prop preserves the deprecated legacy trusted behavior for
backward compatibility. Supplying the prop explicitly, including as `undefined`,
is an explicit policy decision: a deny or missing evaluator raises a structured
`PolicyViolation` through state/data parsing, custom methods, lifecycle methods,
dynamic props, and prop-type rules. It does not silently fall back to trusted
execution.
