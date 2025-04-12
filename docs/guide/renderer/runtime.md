# 使用运行态渲染器

运行态渲染器是将低代码设计生成的 Schema 转换为可交互的最终用户界面的关键组件。本文将指导你如何在项目中正确使用运行态渲染器。

## 基本使用

### 引入渲染器

首先，你需要引入对应的运行态渲染器组件：

```tsx
import { Renderer } from '@easy-editor/react-renderer-dashboard'
```

### 配置渲染器

运行态渲染器的基本用法：

```tsx
import { Renderer } from '@easy-editor/react-renderer-dashboard'
import { components } from '@/materials'

const RuntimePreview = ({ schema }) => {
  return (
    <Renderer
      schema={schema}
      components={components}
    />
  )
}
```

## 必要参数

### schema

schema 参数是描述页面结构和组件配置的核心数据：

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

### components

components 参数是组件名称和实际组件实现的映射关系：

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

## 高级配置

运行态渲染器支持多种高级配置项：

```tsx
<Renderer
  // 必须项：组件配置Schema
  schema={schema}

  // 必须项：组件映射
  components={components}

  // 可选项：视口配置
  viewport={{ width: 1920, height: 1080 }}

  // 可选项：全局属性
  globalProps={{
    theme: 'dark',
    locale: 'zh-CN'
  }}

  // 可选项：应用工具和上下文
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

## 常见场景

### 动态数据加载

结合 useState 和 useEffect 动态加载数据：

```tsx
import { useState, useEffect } from 'react'
import { Renderer } from '@easy-editor/react-renderer-dashboard'
import { components } from '@/materials'

const DynamicDataPage = () => {
  const [schema, setSchema] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 从服务器加载 Schema
    const fetchSchema = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/schema')
        const data = await response.json()
        setSchema(data)
      } catch (error) {
        console.error('Failed to load schema:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchSchema()
  }, [])

  if (loading) {
    return <div>加载中...</div>
  }

  if (!schema) {
    return <div>加载失败</div>
  }

  return (
    <Renderer
      schema={schema}
      components={components}
    />
  )
}
```

### 多页面路由集成

结合 React Router 实现多页面渲染：

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { Renderer } from '@easy-editor/react-renderer-dashboard'
import { components } from '@/materials'

// 懒加载各页面 Schema
const HomePage = lazy(() => import('@/schemas/home'))
const DashboardPage = lazy(() => import('@/schemas/dashboard'))
const ProfilePage = lazy(() => import('@/schemas/profile'))

const PageRenderer = ({ schema }) => (
  <Renderer schema={schema} components={components} />
)

const AppRouter = () => {
  return (
    <BrowserRouter>
      <Suspense fallback={<div>页面加载中...</div>}>
        <Routes>
          <Route path="/" element={<PageRenderer schema={HomePage} />} />
          <Route path="/dashboard" element={<PageRenderer schema={DashboardPage} />} />
          <Route path="/profile" element={<PageRenderer schema={ProfilePage} />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
```

## 下一步

- 了解[编辑态渲染器](/guide/renderer/editor)的使用方法
- 学习如何[自定义渲染器](/guide/renderer/custom)
- 查看[渲染器 API 参考](/reference/renderer)获取更详细的信息
