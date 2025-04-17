# 使用运行态渲染器

运行态渲染器是将低代码设计生成的 Schema 转换为可交互的最终用户界面的关键组件。本文将指导你如何在项目中正确使用运行态渲染器。

## 基本使用

### 引入渲染器

首先，你需要引入对应的运行态渲染器组件：

```tsx
import { Renderer } from '@easy-editor/react-renderer-dashboard'
```

## 配置项

### `schema` (必需)

定义页面结构和组件配置的核心数据。这是渲染器渲染界面的基础。

```tsx
const schema = {
  componentName: 'Page',
  children: [
    {
      componentName: 'Text',
      props: {
        content: '这是一段文本',
        style: {
          fontSize: '24px',
          color: '#333'
        }
      }
    },
    {
      componentName: 'Button',
      props: {
        text: '点击按钮',
        type: 'primary'
      }
    }
  ]
}

<Renderer schema={schema} components={components} />
```

### `components` (必需)

定义组件名称和实际组件实现的映射关系。渲染器通过这个映射找到对应的组件实现。

```tsx
import Text from '@/components/Text'
import Button from '@/components/Button'
import Chart from '@/components/Chart'

const components = {
  Text,
  Button,
  Chart,
  // 其他组件...
}

<Renderer schema={schema} components={components} />
```

### `viewport` (可选)

定义渲染器的视口配置，用于控制渲染区域的大小。

```tsx
<Renderer
  schema={schema}
  components={components}
  viewport={{ width: 1920, height: 1080 }}
/>
```

### `appHelper` (可选)

定义应用工具和上下文，提供导航、请求、事件等功能。

```tsx
<Renderer
  schema={schema}
  components={components}
  appHelper={{
    utils: {
      // 导航处理
      navigate: (path, options) => {
        console.log(`Navigating to ${path}`, options)
        // 实际导航逻辑...
      },
      // API 请求
      request: async (url, options) => {
        const response = await fetch(url, options)
        return response.json()
      },
      // 事件总线
      event: {
        emit: (eventName, data) => {
          console.log(`Event emitted: ${eventName}`, data)
        },
        on: (eventName, callback) => {
          console.log(`Event listener added: ${eventName}`)
        }
      }
    },
    // 应用上下文
    ctx: {
      currentUser: {
        id: '001',
        name: '张三',
        role: 'admin'
      },
      permissions: ['read', 'write', 'manage']
    }
  }}
/>
```

更多详细的 API 说明和用法，请参考 [渲染器 API 文档](../../reference/renderer/index)。
