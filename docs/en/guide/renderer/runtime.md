---
title: Using Runtime Renderer
description: Working with EasyEditor's runtime renderer
---

# Using Runtime Renderer

The runtime renderer is a key component that transforms the Schema generated from low-code design into an interactive final user interface. This guide will walk you through how to properly use the runtime renderer in your project.

## Basic Usage

### Import Renderer

First, you need to import the corresponding runtime renderer component:

```tsx
import { Renderer } from '@easy-editor/react-renderer-dashboard'
```

## Configuration Options

### `schema` (Required)

The core data that defines page structure and component configuration. This is the foundation for the renderer to render the interface.

```tsx
const schema = {
  componentName: 'Page',
  children: [
    {
      componentName: 'Text',
      props: {
        content: 'This is a text',
        style: {
          fontSize: '24px',
          color: '#333'
        }
      }
    },
    {
      componentName: 'Button',
      props: {
        text: 'Click Button',
        type: 'primary'
      }
    }
  ]
}

<Renderer schema={schema} components={components} />
```

### `components` (Required)

Defines the mapping relationship between component names and actual component implementations. The renderer finds the corresponding component implementation through this mapping.

```tsx
import Text from '@/components/Text'
import Button from '@/components/Button'
import Chart from '@/components/Chart'

const components = {
  Text,
  Button,
  Chart,
  // Other components...
}

<Renderer schema={schema} components={components} />
```

### `viewport` (Optional)

Defines the viewport configuration of the renderer, used to control the size of the rendering area.

```tsx
<Renderer
  schema={schema}
  components={components}
  viewport={{ width: 1920, height: 1080 }}
/>
```

### `appHelper` (Optional)

Defines application tools and context, providing navigation, requests, events, and other functions.

```tsx
<Renderer
  schema={schema}
  components={components}
  appHelper={{
    utils: {
      // Navigation handling
      navigate: (path, options) => {
        console.log(`Navigating to ${path}`, options)
        // Actual navigation logic...
      },
      // API requests
      request: async (url, options) => {
        const response = await fetch(url, options)
        return response.json()
      },
      // Event bus
      event: {
        emit: (eventName, data) => {
          console.log(`Event emitted: ${eventName}`, data)
        },
        on: (eventName, callback) => {
          console.log(`Event listener added: ${eventName}`)
        }
      }
    },
    // Application context
    ctx: {
      currentUser: {
        id: '001',
        name: 'John Doe',
        role: 'admin'
      },
      permissions: ['read', 'write', 'manage']
    }
  }}
/>
```

For more detailed API descriptions and usage, please refer to the [Renderer API Documentation](../../reference/renderer/index).

::: warning English Documentation Status
This English documentation is currently under development. The content may be incomplete or subject to change. For the most complete and up-to-date information, please refer to the Chinese documentation. We appreciate your patience as we work to provide comprehensive English documentation.
:::
