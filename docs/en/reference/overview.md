# API Overview

:::info Note
Currently, the API documentation provides API references for the core Editor, Plugin, and Renderer components. Additional API documentation is being continuously updated to provide more comprehensive development guides.
:::

EasyEditor provides a series of powerful APIs for building and extending low-code editors. This section will overview EasyEditor's API architecture system to help you understand how to use these APIs to build your own low-code applications.

## API Categories

EasyEditor's APIs are mainly divided into the following parts:

### Core API

The Core API is the foundation of EasyEditor, providing basic functionality and data structures for the editor. It mainly includes:

- **Project Management**: `Project`, `Document` - Manage low-code projects and documents
- **Node Operations**: `Node`, `Props` - Handle component trees and properties
- **Editor Design**: `Designer`, `Selection`, `Dragon` - Designer core functionality
- **Component Metadata**: `ComponentMeta`, `Setting` - Component configuration and settings
- **Simulator**: `Simulator`, `SimulatorRenderer` - Page rendering and preview

[Learn more about Core API](./core/index)

### Plugin API

The Plugin API allows developers to extend EasyEditor's functionality by creating custom plugins. It includes:

- **Plugin Lifecycle**: Plugin registration, initialization, and unloading
- **Plugin Context**: Access to editor internal functionality
- **Extension Points**: Extend editor functionality at specific locations

[Learn more about Plugin API](./plugin/index)

### Renderer API

The Renderer API is used to customize component rendering methods and supports multi-framework rendering. It includes:

- **Rendering Engine**: Convert Schema to actual UI
- **Rendering Adapter**: Adapt to different frontend frameworks
- **Rendering Hooks**: Customize the rendering process

[Learn more about Renderer API](./renderer/index)

## Getting Started

Based on your needs, select the corresponding API category to view detailed documentation. Each API documentation provides detailed interface descriptions and usage examples.

- Want to explore editor core functionality? Check out [Core API](./core/index)
- Looking for plugin development guide? Check out [Plugin API](./plugin/index)
- Need renderer configuration? Check out [Renderer API](./renderer/index)
