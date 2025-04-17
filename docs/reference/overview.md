# API 总览

:::warning 注意
目前 API 文档仅提供核心的 Editor、Plugin、Renderer 的 API 参考，其他 API 文档仍在开发中。我们会持续更新和完善文档内容，以提供更全面的开发指南。
:::


EasyEditor 提供了一系列强大的 API，用于构建和扩展低代码编辑器。本节将概述 EasyEditor 的 API 体系结构，帮助您了解如何使用这些 API 构建自己的低代码应用。

## API 分类

EasyEditor 的 API 主要分为以下几个部分：

### 核心 API（Core）

核心 API 是 EasyEditor 的基础，提供了编辑器的基本功能和数据结构。主要包括：

- **项目管理**：`Project`、`Document` - 管理低代码项目和文档
- **节点操作**：`Node`、`Props` - 处理组件树和属性
- **编辑器设计**：`Designer`、`Selection`、`Dragon` - 设计器核心功能
- **组件元数据**：`ComponentMeta`、`Setting` - 组件配置和设置
- **模拟器**：`Simulator`、`SimulatorRenderer` - 页面渲染和预览

[了解更多核心 API](./core/index)

### 插件 API（Plugin）

插件 API 允许开发者扩展 EasyEditor 的功能，创建自定义插件。包括：

- **插件生命周期**：插件的注册、初始化和卸载
- **插件上下文**：访问编辑器内部功能
- **扩展点**：在特定位置扩展编辑器功能

[了解更多插件 API](./plugin/index)

### 渲染器 API（Renderer）

渲染器 API 用于自定义组件的渲染方式，支持多框架渲染。包括：

- **渲染引擎**：将 Schema 转换为实际 UI
- **渲染适配器**：适配不同前端框架
- **渲染钩子**：自定义渲染过程

[了解更多渲染器 API](./renderer/index)

## 开始使用

根据您的需求，选择对应的 API 类别查看详细文档。每个 API 文档都提供了详细的接口说明和使用示例。

- 查看编辑器核心功能？查看[核心 API](./core/index)
- 查看插件开发指南？查看[插件 API](./plugin/index)
- 查看渲染器配置？查看[渲染器 API](./renderer/index)
