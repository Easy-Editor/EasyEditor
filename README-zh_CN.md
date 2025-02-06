<div align="center">

<img src=".github/assets/banner-dark.svg" height="100" alt="logo" />

<br />
<br />

<b>一个面向扩展的跨框架低代码引擎</b>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[English](./README.md) | 简体中文

</div>

## 核心特性

- **解耦设计**：引擎核心与框架无关，支持多种框架渲染扩展
- **可视化设计**：完整的设计器实现，拖拽布局、吸附对齐、多设备预览、撤销/重做栈...
- **插件化架构**：灵活的插件系统设计，生命周期管理、热键绑定、类扩展机制、依赖注入...
- **渲染引擎**：多框架支持、实时预览、Schema 驱动、组件隔离沙箱
- **企业级能力**：数据源管理、多语言支持、版本控制、在线协作

## 文档

⏳⏳⏳

## 快速开始

### Dashboard + React

1. 安装

```bash
pnpm install @easyeditor/core @easyeditor/plugin-dashboard @easyeditor/react-renderer-dashboard
```

2. 初始化

```ts
import { createEditor } from '@easyeditor/core'
import DashboardPlugin from '@easyeditor/plugin-dashboard'


export const editor = createEasyEditor({
  plugins: [DashboardPlugin()],
  setters,
  components,
  componentMetas,
})

// 获取核心模块
export const designer = await editor.onceGot<Designer>('designer')
export const project = await editor.onceGot<Project>('project')
export const simulator = await editor.onceGot<Simulator>('simulator')
```

3. 使用

```tsx
// 设计态
import { SimulatorRenderer } from '@easyeditor/react-renderer-dashboard'
<SimulatorRenderer host={simulator} />

// 预览态
import { ReactRenderer } from '@easyeditor/react-renderer-dashboard'
<ReactRenderer components={simulator.components} schema={docSchema} />
```

## 插件开发

```ts
import type { Plugin } from '@easy-editor/core'

const ExamplePlugin: Plugin = ctx => {
  return {
    name: 'ExamplePlugin',
    deps: [],
    init(ctx) {
      const { hotkey } = ctx

      ctx.logger.log('打个日志', ctx)

      // add hotkey
      hotkey.bind('ctrl+d', e => {
        e.preventDefault()
        logger.log('ctrl+d')
      })
    },
    // 扩展类
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

// 使用
createEasyEditor({
  plugins: [ExamplePlugin()],
  // ...
})
```

## 规划

| 模块 | 状态 | 描述 |
| --- | --- | --- |
| example-dashboard | 🚧 开发 | 大屏案例 |
| 文档 | ⏳ 规划 | 使用文档 |
| plugin-form | 🚧 开发 | 表单低代码 |
| react-renderer-form | 🚧 开发 | 表单渲染引擎 |
| vue-renderer | ⏳ 规划 | Vue 框架渲染引擎 |
| vue-renderer-form | ⏳ 规划 | React 框架表单渲染引擎 |
| vue-renderer-dashboard | ⏳ 规划 | React 框架大屏渲染引擎 |
| 版本管理 | 🚧 开发 | 组件版本管理... |
| 国际化 | 🚧 开发 | 支持动态语言包加载 |
| 数据源 | ⏳ 规划 | 支持多种数据源管理 |
| 在线协作 | ⏳ 规划 | 支持多人协作编辑 |

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


## 致谢

感谢 [lowcode-engine](https://github.com/alibaba/lowcode-engine) 的启发和参考。

## 许可证

[MIT](./LICENSE) License &copy; 2024-PRESENT [JinSo](https://github.com/JinSooo)
