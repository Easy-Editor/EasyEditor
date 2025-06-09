---
title: Core Concepts
description: Understanding the core concepts of EasyEditor
---

# Core Concepts

This document will help you understand the basic architecture and core concepts of EasyEditor, laying a solid foundation for your development work.

## Architecture Overview

EasyEditor adopts a modular architecture design where modules communicate through clear interfaces, forming a flexible and extensible low-code engine system. The core architecture consists of four major parts: Engine, Designer, Project Management, and Simulator, with functionality extension through a plugin system.

## Introduction

### Engine

The engine is the core of the entire system, responsible for coordinating the work of various modules and managing the plugin lifecycle. It provides unified event system and state management capabilities, serving as the hub connecting various modules.

```typescript
import {
  init,
  materials,
  plugins,
  project,
  setters,
} from '@easy-editor/core'
import DashboardPlugin from '@easy-editor/plugin-dashboard'

// Register plugins
plugins.registerPlugins([
  DashboardPlugin({
    group: {
      meta: groupMeta,
      initSchema: {
        componentName: 'Group',
        title: 'Group',
        isGroup: true,
      },
    },
  }),
])

// Build component metadata
materials.buildComponentMetasMap(Object.values(componentMetaMap))

// Register setters
setters.registerSetter(setterMap)

// Initialize engine
await init({
  designMode: 'design',
  appHelper: {
    utils: {
      // Custom utility functions
    },
  },
})
```

The engine provides direct access to various core modules such as `project`, `materials`, `setters`, etc., enabling developers to easily access and manipulate these modules. For specific Engine API details, check the [API Reference](../reference/core/index) documentation.

### Designer

The designer is responsible for page layout and interaction, managing user interface interaction logic. It is the core module for users to perform visual editing, providing various capabilities:

**Selection Management**:
- Manages component selection state
- Provides single selection, multi-selection, and deselection functions
- Supports selection by component ID or node instance

**Drag Management (Dragon)**:
- Handles the complete lifecycle of component dragging
- Supports component addition, movement, and position adjustment
- Provides event handling for drag start, during, and end

**Document Operations**:
- Gets the currently edited document
- Manages document history
- Imports and exports document data

The designer exposes clear methods and properties, enabling developers to easily control editor interaction behaviors such as component selection, drag-and-drop, resizing, and other core capabilities.

### Project Management

Project management is responsible for document and resource management, providing document creation, opening, saving, and closing functions, as well as Schema import and export capabilities. It manages all document instances in the editor and is the core module for multi-page application design.

Main capabilities of project management include:

**Document Management**:
- Create new document instances
- Open and switch between different documents
- Save document changes
- Close unnecessary documents

**Schema Management**:
- Export projects as Schema data structures
- Import projects from Schema data structures
- Support Schema processing at different transformation stages

**Resource Management**:
- Manage static resources in projects
- Handle resource reference relationships
- Maintain resource metadata

Project management provides powerful support for multi-page, multi-document application design, enabling developers to easily create complex application structures.

### Simulator

The simulator provides preview and debugging capabilities, responsible for component rendering and interaction. It serves as a bridge connecting the designer and renderer, ensuring users can see effects in real-time during design.

Main functions of the simulator include:

**Viewport Management**:
- Control canvas size and scale
- Support simulation of various device sizes
- Provide canvas zoom and pan capabilities

**Render Control**:
- Configure rendering modes (design-time, preview, runtime)
- Manage component rendering lifecycle
- Handle component events and interactions

**Component Mapping**:
- Map component names in Schema to actual component implementations
- Maintain component instance references
- Manage component context and property passing

The simulator enables developers to preview effects in real-time during the design process, greatly improving design efficiency and accuracy.

### Plugin System

The plugin system provides a mechanism for extending engine capabilities, allowing developers to add new features or modify existing behaviors. It is the key to EasyEditor achieving high extensibility.

Basic structure of a plugin includes:

- **name**: Plugin name, must be unique
- **deps**: Plugin dependencies, declaring dependencies on other plugins
- **init**: Initialization method, executed when plugin loads
- **destroy**: Destruction method, executed when plugin unloads
- **extend**: Extension method, used to extend existing module functionality

The power of the plugin system lies in:

1. **Declarative Dependencies**: Plugins can declare dependencies on other plugins, and the system automatically handles loading order
2. **Context Sharing**: Plugins can share data and methods through context objects
3. **Event Communication**: Plugins can listen to and trigger events, achieving loose coupling communication
4. **Functionality Extension**: Plugins can extend core module functionality, such as adding new methods or modifying existing behaviors

Through the plugin system, EasyEditor can be customized for different requirement scenarios, such as dashboard design, form design, and other professional scenarios.

## Detailed Explanation

### Designer Functionality

The designer provides rich visual editing capabilities, including but not limited to:

**Component Dragging**: Add and move components through drag operations, supporting precise positioning and smart guide lines. The designer provides complete drag lifecycle management, from drag start to end, allowing developers to execute custom logic at different stages.

**Component Selection**: Support multiple selection methods including single selection, multi-selection, and box selection. Selected components display special visual effects and can be configured through property panels. The selection management module maintains the current selected component list and provides rich selection operation APIs.

**Property Configuration**: Visually edit various component properties such as styles and event handling through property panels. The designer applies property changes to components in real-time, achieving what-you-see-is-what-you-get editing experience.

**Layout Adjustment**: Support component resizing, alignment, distribution, and other layout operations to help users quickly build neat interfaces. The layout system supports multiple layout modes such as flow layout, absolute positioning, and flexible layout.

### Project Management Functionality

Project management is responsible for document and resource maintenance, with main functions including:

**Document Management**: Create, open, save, and close documents, supporting multi-document editing and switching. Each document has independent component trees and history records, and can be exported and imported separately.

**Component Management**: Maintain component libraries used in projects, including component registration, uninstallation, and updates. The component management module ensures component metadata and implementation code remain synchronized.

**Configuration Management**: Manage project-level configurations such as themes and internationalization settings. These configurations can affect the rendering and behavior of the entire project.

**History Records**: Provide undo and redo functionality, recording user editing history. The history module uses efficient difference algorithms, only recording necessary change information to ensure reasonable memory usage.

### Simulator Functionality

The simulator provides preview and debugging capabilities, with main functions including:

**Real-time Preview**: Render pages being designed in real-time, allowing users to immediately see editing effects. Real-time preview uses efficient incremental update algorithms, only updating changed parts to ensure preview performance.

**Multi-device Adaptation**: Support simulating different device sizes to preview display effects on different devices. Developers can define custom device configurations such as phones, tablets, and desktops with different sizes.

**Event Simulation**: Support simulating runtime events such as clicks and scrolling during design time, facilitating interactive logic debugging. The event simulation system can record and replay user operations, helping developers troubleshoot interaction issues.

**State Viewing**: View component runtime states, data flow, and property changes to assist debugging. State inspection tools can display component internal states in real-time, helping developers understand component behavior.

## Workflow

Typical EasyEditor workflow:

1. **Initialize Editor**: Create editor instance, load necessary plugins and configurations
2. **Access Core Modules**: Get designer, project management, simulator, and other core module instances
3. **Create/Load Project**: Create new project or load existing project Schema
4. **Edit Design**: Use designer for interface design, add components, configure properties, etc.
5. **Preview Debug**: Use simulator for real-time preview and debugging of design effects
6. **Export Project**: Export completed design as Schema data for saving or publishing

Throughout the process, the editor engine coordinates the work of various modules, ensuring data flow and state synchronization between them, providing a smooth design experience.

## Extension Mechanisms

EasyEditor provides multiple extension mechanisms, allowing developers to customize and enhance system functionality according to requirements:

### Plugin Extension

Plugins are the main way to extend EasyEditor functionality. Through plugins you can:

- Add new functional modules such as data source management, internationalization support, etc.
- Modify existing module behaviors such as custom drag logic, rewrite rendering processes, etc.
- Integrate external systems such as version control, team collaboration features, etc.

Plugins can access various core modules of the editor and communicate with other plugins through the event system, forming a loosely coupled architecture.

### Renderer Extension

Renderers are responsible for converting Schema into actual user interfaces. EasyEditor supports extending different renderer implementations:

- Support different frontend frameworks such as React, Vue, etc.
- Customize rendering behavior for specific scenarios such as dashboard rendering, form rendering, etc.
- Implement different rendering optimization strategies such as lazy loading, virtual scrolling, etc.

Renderers communicate with the editor engine through unified interfaces, ensuring consistency and interoperability of different renderer implementations.

### Material Extension

Materials are basic components for visual building. EasyEditor supports rich material extension capabilities:

- Register custom components as materials
- Define component metadata such as properties, events, styles, etc.
- Configure component setters to achieve visual property editing
- Implement component thumbnails and preview effects

Through material extension, developers can integrate business component libraries into EasyEditor, achieving business-customized low-code platforms.

### Setter Extension

Setters are interactive controls for editing component properties. Through setter extension you can:

- Implement visual editing of complex properties such as color pickers, rich text editors, etc.
- Customize property editing interaction methods to improve user experience
- Implement property editing logic for specific business scenarios such as data binding, conditional configuration, etc.

Setter extension greatly enhances property editing capabilities, making complex configurations simple and intuitive.

## Next Steps

- Check out the [Getting Started](./getting-started) guide to begin using EasyEditor
- Learn about [Plugin Development](./extension/plugin) to extend core functionality
- Study [Renderer Development](./renderer/) to support custom rendering
- Explore [Material Development](./extension/material) to expand component libraries
