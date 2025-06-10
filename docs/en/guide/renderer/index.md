---
title: Renderer Overview
description: Understanding EasyEditor's rendering system
---

# Renderer Development

Renderers are one of the core architectures of EasyEditor, responsible for rendering component configurations from the designer into actual visible interfaces. EasyEditor supports renderer implementations for multiple frameworks. This guide will help you understand the basic concepts and usage of renderers.

## Renderer Overview

EasyEditor's renderers are divided into two modes:

1. **Design-time Renderer**: Used for visual editing in the designer, supporting operations like component selection, dragging, and adjustment.
2. **Runtime Renderer**: Used to render designed configurations into final user-interactive interfaces.

## Built-in Renderers

EasyEditor currently provides the following built-in renderers:

- `@easy-editor/react-renderer`: Basic React renderer
- `@easy-editor/react-renderer-dashboard`: Dashboard application React renderer (extended from React renderer)
- `@easy-editor/react-renderer-form`: Form application React renderer (under development)

## Renderer Usage

### Design-time Renderer

Design-time renderers are typically implemented through the `SimulatorRenderer` component:

```tsx
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
import { project } from './editor'

export const DesignEditor = () => {
  const { designer } = project
  return <SimulatorRenderer designer={designer} />
}
```

### Runtime Renderer

Runtime renderers are implemented through the `Renderer` component:

```tsx
import { Renderer } from '@easy-editor/react-renderer-dashboard'
import { components } from './materials'

export const RuntimePreview = ({ schema }) => {
  return (
    <Renderer
      schema={schema}
      components={components}
      viewport={{ width: 1920, height: 1080 }}
    />
  )
}
```

## Renderer Configuration

Renderers support multiple configuration options:

```tsx
<Renderer
  // Required: Component configuration Schema
  schema={schema}

  // Required: Component mapping
  components={components}

  // Optional: Viewport configuration
  viewport={{ width: 1920, height: 1080 }}

  // Optional: Design mode
  designMode={false}

  // Optional: Application helper object, providing utility methods and context
  appHelper={{
    utils: {
      navigate: (path) => { /* Navigation handling */ },
      request: (url, options) => { /* API request handling */ }
    },
    ctx: {
      currentUser: { /* User information */ }
    }
  }}

  // ...
/>
```

## Renderer Extension

EasyEditor supports developing custom renderers to adapt to different frameworks or specific application scenarios. Renderer extensions can:

1. **Support new frameworks**: Such as Vue, Angular, etc.
2. **Customize rendering behavior**: For example, implement custom rendering logic for specific components
3. **Enhance interaction capabilities**: Add new interaction capabilities, animation effects, etc.

For detailed renderer development guides, please refer to the following sections:

- [Using Design-time Renderer](/en/guide/renderer/editor)
- [Using Runtime Renderer](/en/guide/renderer/runtime)
- [Custom Renderer Development](/en/guide/renderer/custom)
