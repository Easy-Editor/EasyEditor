<div align="center">

<img src=".github/assets/banner-dark.svg" height="100" alt="logo" />

<br />
<br />

<b>A scalable and cross-framework low-code engine for building visual application platforms</b>

[![GitHub License](https://img.shields.io/github/license/Easy-Editor/EasyEditor)](./LICENSE)
[![NPM Version](https://img.shields.io/npm/v/%40easy-editor%2Fcore?label=%40easy-editor%2Fcore&color=%230a7cbd)](https://www.npmjs.com/package/@easy-editor/core)
[![NPM Version](https://img.shields.io/npm/v/%40easy-editor%2Freact-renderer?label=%40easy-editor%2Freact-renderer&color=%230a7cbd)](https://www.npmjs.com/package/@easy-editor/react-renderer)
<br/>
[![NPM Version](https://img.shields.io/npm/v/%40easy-editor%2Fplugin-dashboard?label=%40easy-editor%2Fplugin-dashboard&color=%230a7cbd)](https://www.npmjs.com/package/@easy-editor/plugin-dashboard)
[![NPM Version](https://img.shields.io/npm/v/%40easy-editor%2Freact-renderer-dashboard?label=%40easy-editor%2Freact-renderer-dashboard&color=%230a7cbd)](https://www.npmjs.com/package/@easy-editor/react-renderer-dashboard)

English | [简体中文](./README-zh_CN.md)

</div>

EasyEditor is a cross-framework low-code engine with scale-out design, providing a complete visual design system and flexible plugin architecture. Applications can be quickly built through simple drag-and-drop operations, while supporting rendering extensions for multiple frameworks such as React and Vue. It not only has enterprise-level features but also high customizability, allowing developers to create their own low-code platform according to actual needs.

## Features

- **Decoupling Design**: Engine core is framework-independent, supporting multiple framework rendering extensions
- **Visual Design**: Complete implementation of the designer, drag-and-drop layout, snapping alignment, multi-device preview, undo/redo stack...
- **Plugin Architecture**: Flexible plugin system design, lifecycle management, hotkey binding, class extension mechanism, dependency injection...
- **Rendering Engine**: Multi-framework support, real-time preview, Schema driven, component isolation sandbox
- **Enterprise-level Capabilities**: Data source management, multi-language support, version control, online collaboration

## Technical Architecture

                       +----------------+
                       |  Core          |
                       |  - Schema      |
                       |  - Component   |
                       |  - Plugin      |
                       +----------------+
                           /        \
                          /          \
                         /            \
          +-------------+              +---------------+
          |  Renderers  |              |  Plugins      |
          |  - React    | ------------ |  - Dashboard  |
          |  - Vue      | ------------ |  - Form       |
          |  - Custom   |              |  - Document   |
          +-------------+              +---------------+
                         \            /
                          \          /
                           \        /
                       +----------------+
                       |  Applications  |
                       |  - Dashboard   |
                       |  - Form        |
                       |  - ...         |
                       +----------------+

## Documentation

⏳⏳⏳

## Usage

### Dashboard + React

1. Install

```bash
# For data-driven and reactive processing in core and renderer
pnpm add mobx mobx-react

# Install engine core and plugins
pnpm install @easyeditor/core @easyeditor/plugin-dashboard @easyeditor/react-renderer-dashboard
```

2. Init

```ts
import { createEditor } from '@easyeditor/core'
import DashboardPlugin from '@easyeditor/plugin-dashboard'

export const editor = createEasyEditor({
  plugins: [DashboardPlugin()],
  setters,
  components,
  componentMetas,
})

// get core modules
export const designer = await editor.onceGot<Designer>('designer')
export const project = await editor.onceGot<Project>('project')
export const simulator = await editor.onceGot<Simulator>('simulator')
```

3. Renderer

```tsx
// design mode
import { SimulatorRenderer } from '@easyeditor/react-renderer-dashboard'
<SimulatorRenderer host={simulator} />

// preview mode
import { ReactRenderer } from '@easyeditor/react-renderer-dashboard'
<ReactRenderer components={simulator.components} schema={docSchema} />
```

## Plugin Development

```ts
import type { Plugin } from '@easy-editor/core'

const ExamplePlugin: Plugin = ctx => {
  return {
    name: 'ExamplePlugin',
    deps: [],
    init(ctx) {
      const { hotkey } = ctx

      ctx.logger.log('log', ctx)

      // add hotkey
      hotkey.bind('ctrl+d', e => {
        e.preventDefault()
        logger.log('ctrl+d')
      })
    },
    // extend class
    extend({ extendClass, extend }) {
      extend('Designer', {
        test: {
          value(this: Designer) {
            console.log('test', this)
          },
        },
      })
    }
  }
}

createEasyEditor({
  plugins: [ExamplePlugin()],
  // ...
})
```


## Roadmap

| Module | Status | Description |
| --- | --- | --- |
| example-dashboard | 🚧 doing | Dashboard Example |
| documentation | ⏳ planning | Documentation |
| plugin-form | 🚧 doing | Form low-code |
| react-renderer-form | 🚧 doing | Form renderer |
| vue-renderer | ⏳ planning | Vue renderer |
| vue-renderer-form | ⏳ planning | React form renderer |
| vue-renderer-dashboard | ⏳ planning | React dashboard renderer |
| version-control | ⏳ planning | Component version control |
| i18n | ⏳ planning | Support dynamic language package loading |
| data-source | ⏳ planning | Support multiple data source management |
| online-collaboration | ⏳ planning | Support multi-person collaborative editing |

## Debug

Environment requirements:
- node >= 18.0.0
- pnpm >= 9.12.2

```bash
git clone git@github.com:Easy-Editor/EasyEditor.git
cd EasyEditor
pnpm install
pnpm example:dashboard
```

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests to help improve this project.

## License

[MIT](./LICENSE) License &copy; 2024-PRESENT [JinSo](https://github.com/JinSooo)

## Acknowledgments

Thanks [lowcode-engine](https://github.com/alibaba/lowcode-engine) for inspiration and reference.
