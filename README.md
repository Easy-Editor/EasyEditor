<div align="center">

<img src=".github/assets/banner-dark.svg" height="100" alt="logo" />

<br />
<br />

<b>Plugin-based cross-framework low-code engine for building visual application platforms</b>

[![GitHub License](https://img.shields.io/github/license/Easy-Editor/EasyEditor)](./LICENSE)
[![NPM Version](https://img.shields.io/npm/v/%40easy-editor%2Fcore?label=%40easy-editor%2Fcore&color=%230a7cbd)](https://www.npmjs.com/package/@easy-editor/core)
[![NPM Version](https://img.shields.io/npm/v/%40easy-editor%2Freact-renderer?label=%40easy-editor%2Freact-renderer&color=%230a7cbd)](https://www.npmjs.com/package/@easy-editor/react-renderer)
<br/>
[![NPM Version](https://img.shields.io/npm/v/%40easy-editor%2Fplugin-dashboard?label=%40easy-editor%2Fplugin-dashboard&color=%230a7cbd)](https://www.npmjs.com/package/@easy-editor/plugin-dashboard)
[![NPM Version](https://img.shields.io/npm/v/%40easy-editor%2Freact-renderer-dashboard?label=%40easy-editor%2Freact-renderer-dashboard&color=%230a7cbd)](https://www.npmjs.com/package/@easy-editor/react-renderer-dashboard)

English | [简体中文](./README-zh_CN.md)

</div>

EasyEditor is a plugin-based cross-framework low-code engine, providing a complete visual design system and flexible plugin architecture. Applications can be quickly built through simple drag-and-drop operations, while supporting rendering extensions for multiple frameworks such as React and Vue. It not only has enterprise-level features but also high customizability, allowing developers to create their own low-code platform according to actual needs.

## Features

- **🔌 Decoupling Design**: The engine core is separated from renderer adapters; React is implemented today and other frameworks remain extension targets
- **🧩 Plugin Architecture**: Flexible plugin system design, lifecycle management, hotkey binding, class extension mechanism, dependency injection...
- **⚡ Renderer Engine**: React rendering, real-time preview, Schema-driven composition, and explicit same-realm expression policy boundaries (not a security sandbox)
- **🎨 Visual Design**: Complete implementation of the designer, drag-and-drop layout, snapping alignment, multi-device preview, undo/redo stack...
- **🏢 Enterprise-level Capabilities**: Data source management, multi-language support, version control, online collaboration
- **📦 Component Ecosystem**: Built-in material market, component packaging specifications, material development tools, component version management...

## Documentation

Visit the [online documentation](https://easyeditor.dev/) for more information.

## Roadmap

| Module | Status | Description |
| --- | --- | --- |
| EasyDashboard | ✅ completed | Dashboard Example |
| documentation | ✅ completed | Documentation |
| plugin-form | 🚧 doing | Form low-code |
| react-renderer-form | 🚧 doing | Form renderer |
| vue-renderer | ⏳ planning | Vue renderer |

## Debug

Environment requirements:
- node >= 18.20.8
- pnpm >= 9.12.2

```bash
git clone git@github.com:Easy-Editor/EasyEditor.git
cd EasyEditor
pnpm install
pnpm example:dashboard
```

The release-gated Dashboard lifecycle smoke uses Chromium:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests to help improve this project.

## License

[MIT](./LICENSE) License &copy; 2024-PRESENT [JinSo](https://github.com/JinSooo)

## Acknowledgments

Thanks [lowcode-engine](https://github.com/alibaba/lowcode-engine) for inspiration and reference.

## Community

<div align="center">
  <img src=".github/assets/wechat_self.jpg" height="500" alt="logo" />
</div>
