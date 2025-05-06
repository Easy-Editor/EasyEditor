# @easy-editor/engine

engine package for EasyEditor.

## Features

- **Decoupling Design**：Engine core is framework-independent, supporting multiple framework rendering extensions
- **Visual Design**：Complete implementation of the designer, drag-and-drop layout, snapping alignment, multi-device preview, undo/redo stack...
- **Plugin Architecture**：Flexible plugin system design, lifecycle management, hotkey binding, class extension mechanism, dependency injection...
- **Rendering Engine**：Multi-framework support, real-time preview, Schema driven, component isolation sandbox
- **Enterprise-level Capabilities**：Data source management, multi-language support, version control, online collaboration

## Usage

### Dashboard + React

1. Install

```bash
pnpm install @easyeditor/core
```

2. Init

```ts
import { createEditor } from '@easyeditor/core'

export const editor = createEasyEditor({
  setters,
  components,
  componentMetas,
})

// get core modules
export const designer = await editor.onceGot<Designer>('designer')
export const project = await editor.onceGot<Project>('project')
export const simulator = await editor.onceGot<Simulator>('simulator')
```
