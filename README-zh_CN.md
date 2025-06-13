<div align="center">

<img src=".github/assets/banner-dark.svg" height="100" alt="logo" />

<br />
<br />

<b>用于构建可视化应用平台的插件化跨框架低代码引擎</b>

[![GitHub License](https://img.shields.io/github/license/Easy-Editor/EasyEditor)](./LICENSE)
[![NPM Version](https://img.shields.io/npm/v/%40easy-editor%2Fcore?label=%40easy-editor%2Fcore&color=%230a7cbd)](https://www.npmjs.com/package/@easy-editor/core)
[![NPM Version](https://img.shields.io/npm/v/%40easy-editor%2Freact-renderer?label=%40easy-editor%2Freact-renderer&color=%230a7cbd)](https://www.npmjs.com/package/@easy-editor/react-renderer)
<br/>
[![NPM Version](https://img.shields.io/npm/v/%40easy-editor%2Fplugin-dashboard?label=%40easy-editor%2Fplugin-dashboard&color=%230a7cbd)](https://www.npmjs.com/package/@easy-editor/plugin-dashboard)
[![NPM Version](https://img.shields.io/npm/v/%40easy-editor%2Freact-renderer-dashboard?label=%40easy-editor%2Freact-renderer-dashboard&color=%230a7cbd)](https://www.npmjs.com/package/@easy-editor/react-renderer-dashboard)

[English](./README.md) | 简体中文

</div>

EasyEditor 是一个插件化跨框架低代码引擎，提供了一套完整的可视化设计系统和灵活的插件架构。通过简单的拖拽操作即可快速搭建应用，同时支持 React、Vue 等多种框架的渲染扩展。它不仅拥有企业级的功能特性，还具备高度的可定制性，让开发者能够根据实际需求打造专属的低代码平台。

## 核心特性

- **🔌 解耦设计**: 引擎核心与框架无关，支持多种框架渲染扩展
- **🧩 插件化架构**: 灵活的插件系统设计，生命周期管理、热键绑定、类扩展机制、依赖注入...
- **⚡ 渲染引擎**: 多框架支持、实时预览、Schema 驱动、组件隔离沙箱
- **🎨 可视化设计**: 完整的设计器实现，拖拽布局、吸附对齐、多设备预览、撤销/重做栈...
- **🏢 企业级能力**: 数据源管理、多语言支持、版本控制、在线协作
- **📦 组件生态体系**: 内置物料市场、组件封装规范、物料开发工具、组件版本管理...

## 文档

访问[在线文档](https://easyeditor.dev/)了解更多信息。

## 规划

| 模块 | 状态 | 描述 |
| --- | --- | --- |
| EasyDashboard | ✅ 完成 | 大屏案例 |
| 文档 | ✅ 完成 | 使用文档 |
| plugin-form | 🚧 开发 | 表单低代码 |
| react-renderer-form | 🚧 开发 | 表单渲染引擎 |
| vue-renderer | ⏳ 规划 | Vue 框架渲染引擎 |

## 调试

环境要求:
- node >= 18.0.0
- pnpm >= 9.12.2

```bash
git clone git@github.com:Easy-Editor/EasyEditor.git
cd EasyEditor
pnpm install
pnpm example:dashboard
```

## 贡献

欢迎提交 Issue 和 PR，一起完善这个项目。

## 许可证

[MIT](./LICENSE) License &copy; 2024-PRESENT [JinSo](https://github.com/JinSooo)

## 致谢

感谢 [lowcode-engine](https://github.com/alibaba/lowcode-engine) 的启发和参考。

## 交流群

<div align="center">
  <img src=".github/assets/wechat.jpg" height="500" alt="logo" />
</div>
