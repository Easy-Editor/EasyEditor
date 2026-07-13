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

### 1. Create and initialize an engine

Create the instance in a dedicated module. The current Dashboard plugin extends prototypes in the shared realm, so this example explicitly selects `legacyTrusted`. New hosts that do not depend on legacy plugins should keep the default `agentRestricted` policy.

```typescript
import { createEngine } from '@easy-editor/core/instance'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import DataSourcePlugin from '@easy-editor/plugin-datasource'
import HotkeyPlugin from '@easy-editor/plugin-hotkey'
import { Group, componentMetaMap } from './materials'
import { setterMap } from './setters'

export const engine = createEngine({
  trustPolicy: 'legacyTrusted',
  hostWindow: window,
})

await engine.plugins.registerPlugins([
  DashboardPlugin({
    group: {
      meta: Group,
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

engine.materials.buildComponentMetasMap(Object.values(componentMetaMap))
engine.setters.registerSetter(setterMap)
await engine.init({ designMode: 'design' })

export const project = engine.project
export const designer = engine.designer
```

Each instance owns its Project, materials, setters, plugins, and events. Do not mix these objects with the default facade exported from the `@easy-editor/core` root entry.

### 2. Validate and load a project

Load Schema through the engine-owned host boundary:

```typescript
import {
  type ProjectSchema,
  validateProjectSchema,
} from '@easy-editor/core/instance'
import { engine } from './runtime'

export function loadProject(schema: ProjectSchema) {
  const validated = validateProjectSchema(schema, engine.trustPolicy)
  engine.loadProject(validated, true)
}
```

`engine.loadProject()` runs the Schema preparation pipeline again under the current policy. `agentRestricted` rejects functions, accessors, `JSExpression`, `JSFunction`, and other executable Schema values.

### 3. Configure the simulator

```typescript
import type { Simulator } from '@easy-editor/core/instance'
import { engine } from './runtime'

export const releaseSimulatorReady = engine.project.onSimulatorReady((simulator: Simulator) => {
  simulator.set('deviceStyle', {
    viewport: { width: 1920, height: 1080 },
  })
})
```

Keep the returned unsubscribe function and call it before disposal.

### 4. Use renderers

#### Design-time renderer

```tsx
import { designer } from '@/editor/runtime'
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'

export function DesignEditor() {
  return (
    <div className="editor-container">
      <SimulatorRenderer designer={designer} />
    </div>
  )
}
```

#### Runtime renderer

```tsx
import { Renderer } from '@easy-editor/react-renderer-dashboard'

export function RuntimePreview({ schema, components }) {
  return (
    <Renderer
      schema={schema}
      components={components}
      viewport={{ width: 1920, height: 1080 }}
    />
  )
}
```

### 5. Destroy the engine

Await `engine.destroy()` during application unmount, non-persisted `pagehide`, and HMR disposal:

```typescript
import { engine, releaseSimulatorReady } from './runtime'

export async function destroyEditor() {
  releaseSimulatorReady()
  await engine.destroy()
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => destroyEditor())
}
```

`destroy()` is the cleanup boundary for the whole instance. Do not tear down the engine-owned Project, materials, setters, or remote registry independently.

::: tip v1 projects
If the project still imports `init`, `project`, and other globals from `@easy-editor/core`, follow [Migrate from v1 to v2](/en/guide/migration-v2) to move to an explicit instance.
:::

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
