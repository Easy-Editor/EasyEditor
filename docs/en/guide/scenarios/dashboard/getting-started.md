---
title: Dashboard Design Getting Started
description: Getting started with dashboard design in EasyEditor
---

# Getting Started

This guide will help you quickly build a dashboard design application based on EasyEditor.

## Environment Setup

Ensure your development environment meets the following requirements:

- [Node.js](https://nodejs.org/) version 18 or higher.
- [pnpm](https://pnpm.io/) version 9.12.2 or higher.

::: info Note
We strongly recommend using pnpm as the package manager, and EasyEditor's dependency management is also limited to pnpm installation only.
:::

## Installing Dependencies

```bash
# Install core dependencies
pnpm add @easy-editor/core @easy-editor/plugin-dashboard @easy-editor/react-renderer @easy-editor/react-renderer-dashboard

# Install runtime dependencies
pnpm add mobx mobx-react
```

## Usage

### Initialize Editor

Create a `src/editor/index.ts` file in your project:

```ts
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
})

// Export core modules
export { project, materials, plugins, setters }
export const { designer } = project
```

### Design-time Renderer

The design-time renderer is used for visual design in the editor:

```tsx
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
import { designer } from '@/editor'

export const DesignRenderer = () => {
  return (
    <div className='h-full w-full'>
      <SimulatorRenderer designer={designer} />
    </div>
  )
}
```

### Runtime Renderer

The runtime renderer is used for preview or deployment rendering:

```tsx
import { components } from '@/editor/materials'
import { getPageSchemaFromLocalStorage } from '@/lib/schema'
import { Renderer } from '@easy-editor/react-renderer-dashboard'

const Preview = () => {
  // Get page Schema
  const schema = getPageSchemaFromLocalStorage('home')?.componentsTree[0]

  return (
    <div className='h-full w-full'>
      {schema && (
        <Renderer
          schema={schema}
          components={components}
          viewport={{ width: 1920, height: 1080 }}
        />
      )}
    </div>
  )
}
```

### Material Panel

The material panel is used to display draggable components and templates:

```tsx
import { project } from '@/editor'
import type { Snippet } from '@easy-editor/core'
import { useEffect, useRef } from 'react'

// Single material item
const SnippetItem = ({ snippet }: { snippet: Snippet }) => {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Associate material with DOM element to make it draggable
    const unlink = project.simulator?.linkSnippet(ref.current!, snippet)
    return () => unlink?.()
  }, [snippet])

  return (
    <div ref={ref} className='cursor-move'>
      <span>{snippet.title}</span>
    </div>
  )
}

// Material category list
export const MaterialList = ({ snippets }) => {
  return (
    <div>
      {Object.entries(snippets).map(([category, items]) => (
        <div key={category}>
          <h3>{category}</h3>
          <div>
            {items.map(snippet => (
              <SnippetItem key={snippet.id} snippet={snippet} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
```

### Outline Tree

The outline tree is used to view and manage component structure:

```tsx
import { project } from '@/editor'
import type { Node } from '@easy-editor/core'
import { observer } from 'mobx-react'

export const OutlineTree = observer(({ node }) => {
  const { designer } = project
  const selected = designer.selection.getTopNodes(true)

  const handleSelect = () => {
    if (node.canSelect()) {
      node.select()
    }
  }

  return (
    <div>
      <div
        onClick={handleSelect}
        className={selected.includes(node) ? 'selected' : ''}
      >
        {node.componentName}

        {!node.isRoot && (
          <>
            <button onClick={() => node.hide(!node.isHidden)}>
              {node.isHidden ? 'Show' : 'Hide'}
            </button>
            <button onClick={() => node.lock(!node.isLocked)}>
              {node.isLocked ? 'Unlock' : 'Lock'}
            </button>
          </>
        )}
      </div>

      {node.childrenNodes?.length > 0 && (
        <div style={{ marginLeft: '20px' }}>
          {node.childrenNodes.map((child, index) => (
            <OutlineTree key={index} node={child} />
          ))}
        </div>
      )}
    </div>
  )
})
```

### Property Configuration Panel

The property configuration panel is used to edit properties of selected components:

```tsx
import { project } from '@/editor'
import { customFieldItem } from '@/editor/setters'
import { SettingRender } from '@easy-editor/react-renderer'
import { observer } from 'mobx-react'

export const ConfigurePanel = observer(() => {
  return (
    <div className="h-full w-full">
      <div className="p-2 font-medium border-b">Property Configuration</div>
      <div className="p-2">
        <SettingRender designer={project.designer} customFieldItem={customFieldItem} />
      </div>
    </div>
  )
})
```

Custom setter configuration example (`src/editor/setters.ts`):

```ts
import type { CustomFieldItemProps } from '@easy-editor/react-renderer'

// Custom setter component
export const customFieldItem: CustomFieldItemProps = {
  // Can customize different setter components based on property name or type
  component: (props) => {
    // Custom property editing component
    const { value, onChange, schema } = props

    // Example: Provide custom setter for specific property
    if (schema.field === 'specialFormat') {
      return (
        <div>
          <input
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )
    }

    // Return null to use default setter
    return null
  }
}
```

## Example Project

A complete dashboard design case can be found in the [EasyDashboard](https://github.com/Easy-Editor/EasyDashboard) project, which includes:

1. **Component Dragging** - Drag components from material panel to canvas
2. **Component Editing** - Adjust component properties, position and size
3. **Outline Tree** - View and manage component structure
4. **Page Preview** - Real-time preview of dashboard effects
5. ...
