# 物料扩展

物料是 EasyEditor 页面搭建的基础构建单元。本指南将帮助你了解如何开发和集成自定义物料。

## 概述

物料是构建页面的基本原料，按照粒度可分为以下三种类型：

- **组件（Component）**：最小的可复用单元，仅对外暴露配置项，用户无需了解其内部实现。

- **区块（Block）**：符合低代码协议的一小段 schema，内部可以包含一个或多个组件。

- **模板（Template）**：与区块类似，也是符合低代码协议的 schema，通常用于初始化一个页面。

在低代码编辑器中，物料需要经过一定的配置和处理，才能在平台上使用。这个过程涉及到配置文件的创建，称为资产包。资产包文件中定义了每个物料在低代码编辑器中的使用描述。

## 目录结构

一个完整的物料包含以下文件结构：

```bash
my-component/
├── component.tsx    # 物料组件实现
├── configure.ts     # 物料配置（属性设置）
├── meta.ts          # 物料元数据
└── snippets.ts      # 物料预设
```

## 使用

### 组件实现 (component.tsx)

组件是物料的核心实现，需要遵循 React 组件规范：

```tsx
import React, { type Ref, forwardRef } from 'react'

export interface ButtonProps {
  /**
   * 按钮文本内容
   */
  content: string
  /**
   * 按钮类型
   * @default 'default'
   */
  type?: 'primary' | 'default' | 'danger'
  /**
   * 是否禁用
   * @default false
   */
  disabled?: boolean
  /**
   * 点击事件处理函数
   */
  onClick?: () => void
  /**
   * 自定义类名
   */
  className?: string
  /**
   * 自定义样式
   */
  style?: React.CSSProperties
}

/**
 * 按钮组件
 */
const Button = forwardRef((props: ButtonProps, ref: Ref<HTMLButtonElement>) => {
  const {
    content,
    type = 'default',
    disabled = false,
    onClick,
    className = '',
    style = {}
  } = props

  // 生成按钮样式类
  const getButtonClass = () => {
    const baseClass = 'w-full h-full rounded-md transition-all duration-200'
    const typeClass = {
      default: 'bg-gray-100 hover:bg-gray-200 text-gray-800',
      primary: 'bg-blue-500 hover:bg-blue-600 text-white',
      danger: 'bg-red-500 hover:bg-red-600 text-white'
    }[type]
    const disabledClass = disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'

    return `${baseClass} ${typeClass} ${disabledClass} ${className}`
  }

  return (
    <button
      ref={ref}
      type="button"
      className={getButtonClass()}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={style}
    >
      {content}
    </button>
  )
})

export default Button
```

### 属性配置 (configure.ts)

定义组件在设计器中的可配置属性：

```ts
import type { Configure } from '@easy-editor/core'

const configure: Configure = {
  props: [
    {
      type: 'group',
      title: '基础',
      setter: 'GroupSetter',
      items: [
        {
          type: 'field',
          name: 'content',
          title: '按钮文本',
          setter: 'StringSetter',
        },
        {
          type: 'field',
          name: 'type',
          title: '按钮类型',
          setter: {
            componentName: 'SelectSetter',
            props: {
              options: [
                { label: '默认', value: 'default' },
                { label: '主要', value: 'primary' },
                { label: '危险', value: 'danger' }
              ]
            }
          },
        },
        {
          type: 'field',
          name: 'disabled',
          title: '是否禁用',
          setter: 'BooleanSetter',
        }
      ]
    },
    {
      type: 'group',
      title: '样式',
      setter: 'GroupSetter',
      items: [
        {
          type: 'field',
          name: 'className',
          title: '自定义类名',
          setter: 'StringSetter'
        },
        {
          type: 'field',
          name: 'style',
          title: '自定义样式',
          setter: 'StyleSetter'
        }
      ]
    },
    {
      type: 'group',
      title: '事件',
      setter: 'GroupSetter',
      items: [
        {
          type: 'field',
          name: 'onClick',
          title: '点击事件',
          setter: {
            componentName: 'FunctionSetter',
            props: {
              placeholder: '点击按钮时触发',
              defaultValue: `function() { console.log('按钮被点击'); }`
            }
          }
        }
      ]
    }
  ]
}

export default configure
```

### 元数据定义 (meta.ts)

描述组件的基本信息和分类：

```ts
import type { ComponentMetadata } from '@easy-editor/core'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'Button',        // 组件名称
  title: '按钮',                  // 显示标题
  category: '通用',               // 组件分类
  group: '基础组件',              // 组件分组
  icon: 'ButtonIcon',            // 组件图标
  description: '常用的操作按钮，支持多种类型和状态', // 组件描述
  configure,                     // 属性配置
  snippets,                      // 预设模板
  advanced: {
    callbacks: {                 // 组件回调
      onNodeAdd: (dragObject, currentNode) => {
        // 当组件被添加到画布时触发
        console.log('Button added:', currentNode.id)
        return true              // 返回 true 表示允许添加
      },
      onNodeRemove: (currentNode) => {
        // 当组件被从画布移除时触发
        console.log('Button removed:', currentNode.id)
        return true              // 返回 true 表示允许移除
      }
    },
    supports: {                  // 支持的功能
      style: true,               // 支持样式配置
      events: ['onClick'],       // 支持的事件列表
      loop: false                // 是否支持循环
    },
    component: {
      isContainer: false,        // 是否为容器组件
      nestingRule: {             // 嵌套规则
        childWhitelist: [],      // 子组件白名单
        parentWhitelist: ['Container', 'Form', 'Card'] // 父组件白名单
      }
    }
  }
}

export default meta
```

### 预设模板 (snippets.ts)

定义组件在物料面板中的预设用法：

```ts
import type { Snippet } from '@easy-editor/core'

const snippets: Snippet[] = [
  {
    title: '默认按钮',
    screenshot: 'default.png', // 预览图路径
    schema: {
      componentName: 'Button',
      props: {
        content: '默认按钮',
        type: 'default'
      }
    }
  },
  {
    title: '主要按钮',
    screenshot: 'primary.png',
    schema: {
      componentName: 'Button',
      props: {
        content: '主要按钮',
        type: 'primary'
      }
    }
  },
  {
    title: '危险按钮',
    screenshot: 'danger.png',
    schema: {
      componentName: 'Button',
      props: {
        content: '危险按钮',
        type: 'danger'
      }
    }
  },
  {
    title: '禁用按钮',
    screenshot: 'disabled.png',
    schema: {
      componentName: 'Button',
      props: {
        content: '禁用按钮',
        disabled: true
      }
    }
  }
]

export default snippets
```

### 导出入口 (index.ts)

汇总导出组件和元数据：

```ts
import Button from './src/component'
import meta from './src/meta'

export { Button, meta }
export default Button
```

## 注册物料

在编辑器初始化时注册物料：

```ts
import { createEditor } from '@easy-editor/core'
import Button from './materials/button/component'
import buttonMeta from './materials/button/meta'
import Card from './materials/card/component'
import cardMeta from './materials/card/meta'

const editor = createEditor({
  // 注册组件实现
  components: {
    Button,
    Card
  },
  // 注册组件元数据
  componentMetas: {
    Button: buttonMeta,
    Card: cardMeta
  }
})
```

## 在渲染器中使用

```tsx
import React from 'react'
import { ReactRenderer } from '@easyeditor/react-renderer-dashboard'
import Button from './materials/button/component'

// 组件映射表
const components = {
  Button
}

function Preview() {
  // 简单示例
  const simpleSchema = {
    componentName: 'Button',
    props: {
      content: '点击我',
      type: 'primary',
      onClick: () => console.log('按钮被点击')
    }
  }

  // 复杂示例 - 包含容器组件和子组件
  const complexSchema = {
    componentName: 'Card',
    props: {
      title: '卡片标题'
    },
    children: [
      {
        componentName: 'Button',
        props: {
          content: '卡片内按钮',
          type: 'primary'
        }
      }
    ]
  }

  return (
    <div className="preview-container">
      <h2>简单组件</h2>
      <ReactRenderer
        components={components}
        schema={simpleSchema}
      />

      <h2 className="mt-4">复杂组件</h2>
      <ReactRenderer
        components={components}
        schema={complexSchema}
      />
    </div>
  )
}

export default Preview
```

## 设计器的交互

物料组件与设计器的交互主要通过以下几种方式：

### 设计态与运行态切换

组件可以根据当前的模式调整行为：

```tsx
import React, { forwardRef } from 'react'

export interface ChartProps {
  /**
   * 是否处于设计模式
   */
  __designMode?: boolean
  /**
   * 图表数据
   */
  data?: Array<any>
  // ...其他属性
}

const Chart = forwardRef<HTMLDivElement, ChartProps>((props, ref) => {
  const { __designMode, data = [] } = props

  // 在设计态下显示模拟数据
  const displayData = __designMode && (!data || data.length === 0)
    ? [
        { name: '样例数据A', value: 30 },
        { name: '样例数据B', value: 50 },
        { name: '样例数据C', value: 20 }
      ]
    : data

  return (
    <div ref={ref} className="chart-container">
      {__designMode && (
        <div className="design-indicator absolute top-0 right-0 bg-blue-500 text-white text-xs px-1">
          设计模式
        </div>
      )}
      {/* 图表实现 */}
      <div className="chart-content">
        {/* ... 渲染图表 ... */}
        {JSON.stringify(displayData)}
      </div>
    </div>
  )
})
```

### 组件回调机制

组件可以通过元数据定义回调，响应设计器中的各种事件：

```ts
// 在元数据中定义回调
const meta: ComponentMetadata = {
  // ...其他配置
  advanced: {
    callbacks: {
      // 组件选中时
      onSelectHook: (currentNode) => {
        console.log('Component selected:', currentNode.id)
        return true // 返回 true 表示允许选中
      },

      // 组件属性变更前
      onNodeAdd: (addedNode, currentNode) => {
        console.log('Component added:', addedNode?.id)
        return true // 返回 true 表示允许添加
      },

      // 初始化时调用
      onNodeRemove: (removedNode, currentNode) => {
        console.log('Component removed:', removedNode?.id)
        return true // 返回 true 表示允许移除
      }
    }
  }
}
```

### 嵌套规则配置

通过元数据定义组件的嵌套行为：

```ts
const meta: ComponentMetadata = {
  // ...其他配置
  advanced: {
    component: {
      // 是否为容器组件
      isContainer: true,

      // 嵌套规则
      nestingRule: {
        // 允许作为子组件的组件列表
        childWhitelist: ['Button', 'Text', 'Image'],

        // 允许作为父组件的组件列表
        parentWhitelist: ['Page', 'Section', 'Container']
      }
    }
  }
}
```
