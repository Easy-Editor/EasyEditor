---
title: Material Extension
description: Developing custom materials for EasyEditor
---

# Material Extension

Materials are the fundamental building units for page construction in EasyEditor. This guide will help you understand how to develop and integrate custom materials.

## Overview

Materials are the basic components for building pages. Based on granularity, they can be classified into the following three types:

- **Component**: The smallest reusable unit that only exposes configuration items, with users not needing to understand its internal implementation.

- **Block**: A small piece of schema that conforms to low-code protocols and can contain one or more components internally.

- **Template**: Similar to blocks, also schema that conforms to low-code protocols, typically used to initialize a page.

In low-code editors, materials need to undergo certain configuration and processing before they can be used on the platform. This process involves creating configuration files, called asset packages. Asset package files define the usage description of each material in the low-code editor.

## Directory Structure

A complete material contains the following file structure:

```bash
my-component/
├── component.tsx    # Material component implementation
├── configure.ts     # Material configuration (property settings)
├── meta.ts          # Material metadata
└── snippets.ts      # Material presets
```

## Usage

### Component Implementation (component.tsx)

The component is the core implementation of the material and needs to follow React component specifications:

```tsx
import React, { type Ref, forwardRef } from 'react'

export interface ButtonProps {
  /**
   * Button text content
   */
  content: string
  /**
   * Button type
   * @default 'default'
   */
  type?: 'primary' | 'default' | 'danger'
  /**
   * Whether disabled
   * @default false
   */
  disabled?: boolean
  /**
   * Click event handler
   */
  onClick?: () => void
  /**
   * Custom class name
   */
  className?: string
  /**
   * Custom styles
   */
  style?: React.CSSProperties
}

/**
 * Button component
 */
const Button = forwardRef((props: ButtonProps, ref: Ref<HTMLButtonElement>) => {
  const {
    content,
    type = 'default',
    disabled = false,
    onClick,
    className = '',
    style = {}
  } = props

  // Generate button style classes
  const getButtonClass = () => {
    const baseClass = 'w-full h-full rounded-md transition-all duration-200'
    const typeClass = {
      default: 'bg-gray-100 hover:bg-gray-200 text-gray-800',
      primary: 'bg-blue-500 hover:bg-blue-600 text-white',
      danger: 'bg-red-500 hover:bg-red-600 text-white'
    }[type]
    const disabledClass = disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'

    return `${baseClass} ${typeClass} ${disabledClass} ${className}`
  }

  return (
    <button
      ref={ref}
      type="button"
      className={getButtonClass()}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={style}
    >
      {content}
    </button>
  )
})

export default Button
```

### Property Configuration (configure.ts)

Define configurable properties of the component in the designer:

```ts
import type { Configure } from '@easy-editor/core'

const configure: Configure = {
  props: [
    {
      type: 'group',
      title: 'Basic',
      setter: 'GroupSetter',
      items: [
        {
          type: 'field',
          name: 'content',
          title: 'Button Text',
          setter: 'StringSetter',
        },
        {
          type: 'field',
          name: 'type',
          title: 'Button Type',
          setter: {
            componentName: 'SelectSetter',
            props: {
              options: [
                { label: 'Default', value: 'default' },
                { label: 'Primary', value: 'primary' },
                { label: 'Danger', value: 'danger' }
              ]
            }
          },
        },
        {
          type: 'field',
          name: 'disabled',
          title: 'Disabled',
          setter: 'BooleanSetter',
        }
      ]
    },
    {
      type: 'group',
      title: 'Style',
      setter: 'GroupSetter',
      items: [
        {
          type: 'field',
          name: 'className',
          title: 'Custom Class Name',
          setter: 'StringSetter'
        },
        {
          type: 'field',
          name: 'style',
          title: 'Custom Styles',
          setter: 'StyleSetter'
        }
      ]
    },
    {
      type: 'group',
      title: 'Events',
      setter: 'GroupSetter',
      items: [
        {
          type: 'field',
          name: 'onClick',
          title: 'Click Event',
          setter: {
            componentName: 'FunctionSetter',
            props: {
              placeholder: 'Triggered when button is clicked',
              defaultValue: `function() { console.log('Button clicked'); }`
            }
          }
        }
      ]
    }
  ]
}

export default configure
```

### Metadata Definition (meta.ts)

Describe basic information and classification of the component:

```ts
import type { ComponentMetadata } from '@easy-editor/core'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'Button',        // Component name
  title: 'Button',                // Display title
  category: 'General',            // Component category
  group: 'Basic Components',      // Component group
  icon: 'ButtonIcon',             // Component icon
  description: 'Common operation button supporting multiple types and states', // Component description
  configure,                      // Property configuration
  snippets,                       // Preset templates
  advanced: {
    callbacks: {                  // Component callbacks
      onNodeAdd: (dragObject, currentNode) => {
        // Triggered when component is added to canvas
        console.log('Button added:', currentNode.id)
        return true              // Return true to allow addition
      },
      onNodeRemove: (currentNode) => {
        // Triggered when component is removed from canvas
        console.log('Button removed:', currentNode.id)
        return true              // Return true to allow removal
      }
    },
    supports: {                  // Supported features
      style: true,               // Support style configuration
      events: ['onClick'],       // Supported event list
      loop: false                // Whether supports loop
    },
    component: {
      isContainer: false,        // Whether is container component
      nestingRule: {             // Nesting rules
        childWhitelist: [],      // Child component whitelist
        parentWhitelist: ['Container', 'Form', 'Card'] // Parent component whitelist
      }
    }
  }
}

export default meta
```

### Preset Templates (snippets.ts)

Define preset usage of the component in the material panel:

```ts
import type { Snippet } from '@easy-editor/core'

const snippets: Snippet[] = [
  {
    title: 'Default Button',
    screenshot: 'default.png', // Preview image path
    schema: {
      componentName: 'Button',
      props: {
        content: 'Default Button',
        type: 'default'
      }
    }
  },
  {
    title: 'Primary Button',
    screenshot: 'primary.png',
    schema: {
      componentName: 'Button',
      props: {
        content: 'Primary Button',
        type: 'primary'
      }
    }
  },
  {
    title: 'Danger Button',
    screenshot: 'danger.png',
    schema: {
      componentName: 'Button',
      props: {
        content: 'Danger Button',
        type: 'danger'
      }
    }
  },
  {
    title: 'Disabled Button',
    screenshot: 'disabled.png',
    schema: {
      componentName: 'Button',
      props: {
        content: 'Disabled Button',
        disabled: true
      }
    }
  }
]

export default snippets
```

### Export Entry (index.ts)

Aggregate and export component and metadata:

```ts
import Button from './src/component'
import meta from './src/meta'

export { Button, meta }
export default Button
```

## Register Materials

Register materials during engine initialization:

```ts
import {
  init,
  materials,
  setters,
} from '@easy-editor/core'
import Button from './materials/button/component'
import buttonMeta from './materials/button/meta'
import Card from './materials/card/component'
import cardMeta from './materials/card/meta'

// Build component metadata mapping
materials.buildComponentMetasMap([buttonMeta, cardMeta])

// When using in renderer, need to provide component mapping
export const components = {
  Button,
  Card
}

// Initialize engine
await init({
  designMode: 'design',
})
```

## Usage in Renderer

```tsx
import React from 'react'
import { Renderer } from '@easy-editor/react-renderer-dashboard'
import Button from './materials/button/component'

// Component mapping table
const components = {
  Button
}

function Preview() {
  // Simple example
  const simpleSchema = {
    componentName: 'Button',
    props: {
      content: 'Click Me',
      type: 'primary',
      onClick: () => console.log('Button clicked')
    }
  }

  // Complex example - includes container component and child components
  const complexSchema = {
    componentName: 'Card',
    props: {
      title: 'Card Title'
    },
    children: [
      {
        componentName: 'Button',
        props: {
          content: 'Button in Card',
          type: 'primary'
        }
      }
    ]
  }

  return (
    <div className="preview-container">
      <h2>Simple Component</h2>
      <Renderer
        components={components}
        schema={simpleSchema}
      />

      <h2 className="mt-4">Complex Component</h2>
      <Renderer
        components={components}
        schema={complexSchema}
      />
    </div>
  )
}

export default Preview
```

## Interaction with Designer

The interaction between material components and the designer mainly occurs through the following methods:

### Switching Between Design Mode and Runtime Mode

Components can adjust their behavior based on the current mode:

```tsx
import React, { forwardRef } from 'react'

export interface ChartProps {
  /**
   * Whether in design mode
   */
  __designMode?: boolean
  /**
   * Chart data
   */
  data?: Array<any>
  // ...other properties
}

const Chart = forwardRef<HTMLDivElement, ChartProps>((props, ref) => {
  const { __designMode, data = [] } = props

  // Display mock data in design mode
  const displayData = __designMode && (!data || data.length === 0)
    ? [
        { name: 'Sample Data A', value: 30 },
        { name: 'Sample Data B', value: 50 },
        { name: 'Sample Data C', value: 20 }
      ]
    : data

  return (
    <div ref={ref} className="chart-container">
      {__designMode && (
        <div className="design-indicator absolute top-0 right-0 bg-blue-500 text-white text-xs px-1">
          Design Mode
        </div>
      )}
      {/* Chart implementation */}
      <div className="chart-content">
        {/* ... render chart ... */}
        {JSON.stringify(displayData)}
      </div>
    </div>
  )
})
```

### Component Callback Mechanism

Components can define callbacks through metadata to respond to various events in the designer:

```ts
// Define callbacks in metadata
const meta: ComponentMetadata = {
  // ...other configurations
  advanced: {
    callbacks: {
      // When component is selected
      onSelectHook: (currentNode) => {
        console.log('Component selected:', currentNode.id)
        return true // Return true to allow selection
      },

      // Before component property changes
      onNodeAdd: (addedNode, currentNode) => {
        console.log('Component added:', addedNode?.id)
        return true // Return true to allow addition
      },

      // Called during initialization
      onNodeRemove: (removedNode, currentNode) => {
        console.log('Component removed:', removedNode?.id)
        return true // Return true to allow removal
      }
    }
  }
}
```

### Nesting Rules Configuration

Define component nesting behavior through metadata:

```ts
const meta: ComponentMetadata = {
  // ...other configurations
  advanced: {
    component: {
      // Whether is container component
      isContainer: true,

      // Nesting rules
      nestingRule: {
        // List of components allowed as children
        childWhitelist: ['Button', 'Text', 'Image'],

        // List of components allowed as parents
        parentWhitelist: ['Page', 'Section', 'Container']
      }
    }
  }
}
```
