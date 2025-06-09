---
title: Using Design-time Renderer
description: Working with EasyEditor's design-time renderer
---

# Using Design-time Renderer

The design-time renderer is a core component in EasyEditor's design environment, responsible for connecting component libraries with the designer and providing interactive capabilities such as dragging, selecting, and resizing. This guide will walk you through how to properly use the design-time renderer in your project.

## Basic Usage

### Import Renderer

First, you need to import the corresponding design-time renderer component and styles:

```tsx
// Import design-time renderer component
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
```

### Configure Renderer

The design-time renderer needs to connect to the simulator instance:

```tsx
import { simulator } from './editor'

const DesignEditor = () => {
  return (
    <div className="design-editor">
      <SimulatorRenderer host={simulator} />
    </div>
  )
}
```

## Configuration Options

### `host` (Required)

The design-time renderer needs to connect to the simulator instance through the host property.

```tsx
<SimulatorRenderer host={simulator} />
```

### `bemTools` (Optional)

Configure the behavior and display of BEM tools, can be set to an object or false. If set to false, BEM tools functionality will be completely disabled.

```tsx
// Enable and configure bemTools
<SimulatorRenderer
  host={simulator}
  bemTools={{
    // Whether to enable hover component functionality
    detecting: true,

    // Whether to enable component resizing functionality
    resizing: true,

    // Whether to enable component selection functionality
    selecting: true,

    // Whether to show guide lines
    guideLine: true,

    // Custom extra content
    extra: <CustomToolbar />
  }}
/>
```

```tsx
// Completely disable BEM tools
<SimulatorRenderer
  host={simulator}
  bemTools={false}
/>
```

### Custom Helper Tools

You can add custom helper tools through the `bemTools.extra` property:

```tsx
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
import { simulator } from './editor'

// Custom helper tools component
const CustomTools = () => {
  return (
    <div className="custom-tools">
      <button
        className="tool-button"
        onClick={() => {
          // Get currently selected node
          const selectedNode = simulator.designer.selection.selected[0]
          if (selectedNode) {
            // Execute custom operation
            console.log('Selected node:', selectedNode.id)
          }
        }}
      >
        Custom Tool
      </button>
    </div>
  )
}

const DesignEditor = () => {
  return (
    <div className="design-editor">
      <SimulatorRenderer
        host={simulator}
        bemTools={{
          // Add custom tools
          extra: <CustomTools />
        }}
      />
    </div>
  )
}
```

## Device Viewport Configuration

The design-time renderer automatically adjusts the scale ratio based on canvas size to adapt to different viewport sizes. The default viewport size is `1920x1080`, which can be customized as follows:

```ts
// Custom device viewport size
simulator.set('deviceStyle', {
  viewport: {
    width: 1920,
    height: 1080,
  },
})
```

## designMode Toggle

The design-time renderer determines whether to show helper tools based on the simulator's `designMode`:

```tsx
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
import { simulator } from './editor'
import { useState } from 'react'

const DesignEditor = () => {
  const [isDesignMode, setIsDesignMode] = useState(true)

  const toggleMode = () => {
    // Toggle design mode/runtime mode
    simulator.set('designMode', isDesignMode ? 'live' : 'design')
    setIsDesignMode(!isDesignMode)
  }

  return (
    <div className="design-editor">
      <div className="toolbar">
        <button onClick={toggleMode}>
          {isDesignMode ? 'Runtime Mode' : 'Design Mode'}
        </button>
      </div>
      <SimulatorRenderer host={simulator} />
    </div>
  )
}
```

## Renderer Internal Structure

The DOM structure of the design-time renderer is as follows:

```html
<div class="easy-editor">
  <!-- Canvas area -->
  <div class="easy-editor-canvas easy-editor-device-default-canvas">
    <!-- Viewport area -->
    <div class="easy-editor-viewport easy-editor-device-default-viewport">
      <!-- Helper tools -->
      <div class="easy-editor-bem-tools">
        <!-- Various helper tools -->
        <div class="easy-editor-border-detecting"></div>
        <div class="easy-editor-border-selecting"></div>
        <div class="easy-editor-border-resizing"></div>
        <div class="easy-editor-guide-line"></div>
        <!-- Custom tools -->
      </div>
      <!-- Content area -->
      <div class="easy-editor-content"></div>
    </div>
  </div>
</div>
```

Understanding this structure helps you customize the renderer's styles and behavior through CSS.
