# 使用运行态

运行态渲染器是 EasyEditor 中用于在生产环境中渲染页面的核心组件。它与设计态渲染器共享许多基础功能，但在实现上更注重性能和稳定性。以下是关于运行态渲染器的详细说明。

## 快速开始

### 安装依赖

```bash
pnpm add @easy-editor/react-renderer
```

### 基础使用

```typescript
import { rendererFactory } from '@easy-editor/react-renderer'
import { components } from '@/editor/materials'

const Renderer = rendererFactory()

const App = () => {
  const schema = {/* 页面组件树的 JSON 描述 */}
  return <Renderer schema={schema} components={components} />
}
```


## Renderer 扩展

`@easy-editor/react-renderer-dashboard` 是基于基础渲染器的扩展实现，专门为大屏场景优化。

### 使用案例

```typescript
import { Renderer } from '@easy-editor/react-renderer-dashboard'
import { components } from '@/editor/materials'

const DashboardPreview = () => {
  const schema = {/* 页面组件树的 JSON 描述 */}

  return (
    <div className='h-full w-full'>
      <Renderer
        schema={schema}
        components={components}
        viewport={{ width: 1920, height: 1080 }}
        appHelper={{
          utils: {
            navigate: (e: Event, path: string) => {
              // 处理页面跳转
              window.location.href = path
            },
            request: async (config) => {
              // 处理数据请求
              const response = await fetch(config.uri, config)
              return response.json()
            }
          },
        }}
      />
    </div>
  )
}
```

## 配置说明

这里只展示了部分核心属性的介绍，详细可以查看 [Renderer API](docs/api/renderer.md)

| 参数 | 说明 | 类型 | 默认值 |
|------|------|------|--------|
| schema | 页面组件树的 JSON 描述，用于定义页面的结构和内容 | `RootSchema \| NodeSchema` | - |
| components | 组件依赖的实例，包含所有可用的自定义组件和基础组件 | `Record<string, React.ComponentType<any>>` | - |
| viewport | 视口配置，定义画布的宽度和高度 | `{ width: number, height: number }` | - |
| appHelper | 应用助手，提供全局工具函数和常量 | `RendererAppHelper` | - |
| designMode | 设计模式，可选值：`live`、`design` | `DesignMode` | - |
| device | 设备信息，支持 `default`、`pc`、`mobile` | `'default' \| 'pc' \| 'mobile' \| string` | `'default'` |

通过以上文档，您可以快速了解运行态渲染器的使用方法及其与设计态的区别。后续的渲染器定制将进一步介绍如何根据具体需求调整渲染器的行为。

## 运行态与设计态的区别

- **设计态**：主要用于开发环境，提供实时预览和编辑功能，支持组件拖拽、属性修改等。
- **运行态**：用于生产环境，专注于稳定性和性能，去除了设计态的编辑功能。

## 下一步

- [EasyDashboard 运行态页面](https://github.com/Easy-Editor/EasyDashboard/blob/main/src/pages/preview/index.tsx)
- [设计态渲染器文档](docs/guide/renderer/editor.md)
