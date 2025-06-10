---
title: Getting Started
description: Get started with EasyEditor
---

# Getting Started

This guide will help you quickly get started with EasyEditor, a pluggable cross-framework low-code engine for building visual application platforms.

## Environment Requirements

- [Node.js](https://nodejs.org/) version 18 or higher.
- [pnpm](https://pnpm.io/) version 9.12.2 or higher.

::: info Note
We strongly recommend using pnpm as the package manager, and EasyEditor's dependency management is also limited to pnpm installation only.
:::

## Creating a Project

EasyEditor provides two ways to create a project:

### Using Scaffolding (Recommended)

Use the official scaffolding to quickly create a complete EasyEditor project:

::: code-group
```sh [pnpm]
pnpm create @easy-editor my-project
```

```sh [npm]
npm init @easy-editor my-project
```

```sh [npx]
npx @easy-editor/create my-project
```
:::

The scaffolding will guide you to choose application scenarios and frameworks:

- **Application Scenarios**:
  - Dashboard (Dashboard applications)
  - Form (Form applications, under development)

- **Frameworks**:
  - React
  - Vue (under development)

After creation, enter the project directory and start the development server:

```sh
cd my-project
pnpm install
pnpm dev
```

### Manual Installation

If you need to integrate into an existing project, you can manually install dependencies:

::: code-group
```sh [Basic Dependencies]
# For core and renderer data-driven and reactive processing
pnpm add mobx mobx-react

# Install engine core
pnpm add @easy-editor/core @easy-editor/renderer-core @easy-editor/react-renderer
```
:::

Install corresponding plugins and renderers based on your application scenario:

::: code-group
```sh [Dashboard Applications]
# Install dashboard design plugin and renderer
pnpm add @easy-editor/plugin-dashboard @easy-editor/react-renderer-dashboard
```

```sh [Form Applications]
# Install form design plugin and renderer (under development)
```
:::

## Basic Usage

### 1. Initialize Editor

The editor initialization approach has been updated. Now using a more modular approach:

```typescript
import {
  init,
  materials,
  plugins,
  project,
  setters,
} from '@easy-editor/core'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import DataSourcePlugin from '@easy-editor/plugin-datasource'
import HotkeyPlugin from '@easy-editor/plugin-hotkey'

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
  DataSourcePlugin(),
  HotkeyPlugin(),
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

### 2. Access Core Modules

After initialization, you can directly use the exported core modules:

```typescript
import { project, plugins, materials, setters } from '@easy-editor/core'

// Designer: Design core, accessed through project.designer
const { designer } = project

// Project: Project management, responsible for project document management
// project can be used directly

// Other modules can also be used directly
console.log('Plugins:', plugins)
console.log('Materials:', materials)
console.log('Setters:', setters)
```

### 3. Set Project Data and Simulator

```typescript
import { type Simulator } from '@easy-editor/core'

// Listen for simulator ready
project.onSimulatorReady((simulator: Simulator) => {
  // Set canvas size
  simulator.set('deviceStyle', {
    viewport: { width: 1920, height: 1080 }
  })

  // Load project mode
  project.load(projectSchema, true)
})
```

### 4. Using Renderers

EasyEditor provides two rendering modes:

#### Design-time Renderer

Used in editing environment, providing drag, select and other interactive functions:

```tsx
import { project } from '@easy-editor/core'
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
import { observer } from 'mobx-react'

const DesignEditor = observer(() => {
  const { designer } = project

  return (
    <div className="editor-container">
      <SimulatorRenderer designer={designer} />
    </div>
  )
})
```

#### Runtime Renderer

Used for preview or production environment, only renders content without editing features:

```tsx
import { Renderer } from '@easy-editor/react-renderer-dashboard'

const RuntimePreview = ({ schema, components }) => {
  return (
    <Renderer
      schema={schema}
      components={components}
      viewport={{ width: 1920, height: 1080 }}
    />
  )
}
```

## Core Concepts

Understanding the following core concepts will help you better use EasyEditor:

- **Engine**: The core of the entire low-code platform, responsible for coordinating the work of various modules
- **Designer**: The module responsible for page layout and interaction
- **Project**: The module that manages documents and resources
- **Simulator**: The module that provides preview and debugging capabilities
- **Plugins**: Modules that extend EasyEditor functionality
- **Setters**: UI controls for configuring component properties
- **Materials**: Component libraries that can be used in the designer
- **ComponentMetas**: Configuration information describing components

::: tip Tip
Check out the [Core Concepts](/en/guide/core-concepts) documentation to learn more about EasyEditor's architectural design.
:::

## Project Structure

Recommended directory structure:

### Scaffolding Project Structure

Projects created using scaffolding already include complete directory structure:

```
my-project/
├── src/
│   ├── editor/
│   │   ├── materials/      # Materials - component definitions and configuration
│   │   │   ├── components/ # Component implementations
│   │   │   ├── meta/       # Component metadata
│   │   │   └── index.ts    # Material exports
│   │   ├── setters/        # Property setter implementations
│   │   ├── const.ts        # Constants and default configuration
│   │   └── index.ts        # Editor initialization
│   ├── components/         # Application components
│   │   ├── Center.tsx      # Center canvas area
│   │   ├── Left.tsx        # Left panel
│   │   └── Right.tsx       # Right panel
│   ├── pages/              # Application pages
│   │   └── index.tsx       # Main page
│   └── App.tsx             # Application entry
├── package.json
└── README.md
```

### Manual Integration Project Structure

Recommended structure when manually integrating into existing projects:

```
src/
├── editor/
│   ├── materials/      # Materials - component definitions and configuration
│   │   ├── components/ # Component implementations
│   │   ├── setters/    # Property setter implementations
│   │   └── index.ts    # Material exports
│   ├── plugins/        # Custom plugins
│   ├── config/         # Editor configuration
│   └── index.ts        # Editor initialization
├── pages/              # Application pages
│   ├── editor.tsx      # Designer page
│   └── preview.tsx     # Preview page
└── index.tsx           # Application entry
```

## Scenario Practice

EasyEditor supports multiple application scenarios, each with its specific plugins and renderers:

### Dashboard Applications

Dashboard application scenarios provide rich visualization components and layout systems, suitable for data dashboards, monitoring centers and other scenarios.

::: tip Tip
Check out the [Dashboard Application Guide](./scenarios/dashboard/index) to learn how to build professional visualization dashboard applications.
:::

### Form Applications

Form application scenarios provide powerful form design capabilities, supporting complex data entry and validation logic.

::: info Under Development
Form application scenarios are actively under development, stay tuned! Check out the [Form Application Guide](./scenarios/form/index) for the latest progress.
:::

## Example Projects

You can check out the following example projects to learn more about how to use EasyEditor:

- [EasyDashboard](https://github.com/Easy-Editor/EasyDashboard): Professional dashboard application example built with EasyEditor
- More examples are under development

## Next Steps

- Learn about [EasyEditor's Design Philosophy](./why)
- Explore [Core Concepts](./core-concepts) for in-depth understanding of the architecture
- Learn how to perform [Plugin Extensions](./extension/plugin)
- Check out the [Dashboard Application Guide](./scenarios/dashboard/index) to build data visualization applications
- Refer to [API Documentation](../reference/overview) for detailed API information
