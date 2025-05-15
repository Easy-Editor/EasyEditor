# @easy-editor/core

Core specification and type package for EasyEditor, a cross-framework low-code editor with a scalable architecture.

## Package Structure

This package provides two main entry points:

### 1. Main Entry Point (`@easy-editor/core`)

The main entry point provides specifications, interfaces, and types:
- Core interfaces and abstract classes
- Type definitions for all components and modules
- Base structures for plugins, documents, and components
- Standard events and constants
- Utility functions and helpers

### 2. Engine Entry Point (`@easy-editor/core/engine`)

The engine entry point provides the concrete implementation that users should import and use directly:
- Ready-to-use editor instance
- Fully configured plugin system
- Initialized core modules
- Export of common services (designer, project, etc.)
- Lifecycle management (init, destroy)

## Features

- **Framework Agnostic**: Core is designed to work with any frontend framework
- **Plugin Architecture**: Extensible system for adding features and capabilities
- **Visual Design**: Complete designer implementation with drag-and-drop, alignment, and undo/redo
- **Component Model**: Structured component definition and management system
- **Event System**: Powerful event bus for communication between modules
- **Configuration System**: Centralized config management with plugin integration
- **Project Management**: Handles documents, history, serialization, and more
- **Type Safety**: Comprehensive TypeScript definitions for all components
