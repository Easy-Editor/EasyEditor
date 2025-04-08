# 物料扩展

物料是 EasyEditor 页面搭建的基础构建单元。本指南将帮助你了解如何开发和集成自定义物料。

## 物料介绍

物料是构建页面的基本原料，按照粒度可分为以下三种类型：

- **组件（Component）**：最小的可复用单元，仅对外暴露配置项，用户无需了解其内部实现。

- **区块（Block）**：符合低代码协议的一小段 schema，内部可以包含一个或多个组件。用户可以将区块拖入设置器后，自由修改其内部内容。

- **模板（Template）**：与区块类似，也是符合低代码协议的 schema，但其根节点的 componentName 必须固定为 Page，通常用于初始化一个页面。

在低代码编辑器中，物料需要经过一定的配置和处理，才能在平台上使用。这个过程涉及到配置文件的创建，称为资产包。资产包文件中定义了每个物料在低代码编辑器中的使用描述。

## 物料结构

一个完整的物料包含以下文件：

```bash
button/
├── component.tsx    # 物料组件
├── configure.ts     # 物料配置
├── meta.ts          # 物料元数据
└── snippets.ts      # 物料预设
```

## 物料开发

### 1. 组件实现 (component.tsx)

组件是物料的核心实现，需要遵循 React 组件规范：

```tsx
import { type Ref } from 'react'

interface ButtonProps {
  ref: Ref<HTMLButtonElement>
  content: string
  type?: 'primary' | 'default'
  onClick?: () => void
}

const Button = (props: ButtonProps) => {
  const { ref, content, type = 'default', onClick } = props

  return (
    <button
      ref={ref}
      type="button"
      className={`w-full h-full ${
        type === 'primary' ? 'bg-blue-500 text-white' : 'bg-gray-100'
      }`}
      onClick={onClick}
    >
      {content}
    </button>
  )
}

export default Button
```

### 2. 属性配置 (configure.ts)

定义组件在设计器中的可配置属性：

```typescript
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
          defaultValue: '按钮'
        },
        {
          type: 'field',
          name: 'type',
          title: '按钮类型',
          setter: 'SelectSetter',
          options: [
            { label: '默认', value: 'default' },
            { label: '主要', value: 'primary' }
          ],
          defaultValue: 'default'
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
          setter: 'FunctionSetter'
        }
      ]
    }
  ]
}

export default configure
```

### 3. 元数据定义 (meta.ts)

描述组件的基本信息和分类：

```typescript
import type { ComponentMetadata } from '@easy-editor/core'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'Button',        // 组件名称
  title: '按钮',                  // 显示标题
  category: '通用',               // 组件分类
  icon: 'ButtonIcon',            // 组件图标
  description: '常用的操作按钮',   // 组件描述
  configure,                     // 属性配置
  snippets                       // 预设模板
}

export default meta
```

### 4. 预设模板 (snippets.ts)

定义组件在物料面板中的预设用法：

```typescript
import type { Snippet } from '@easy-editor/core'

const snippets: Snippet[] = [
  {
    title: '默认按钮',
    screenshot: 'button-default.png', // 预览图
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
    screenshot: 'button-primary.png',
    schema: {
      componentName: 'Button',
      props: {
        content: '主要按钮',
        type: 'primary'
      }
    }
  }
]

export default snippets
```

## 注册与使用

### 注册物料

在编辑器初始化时注册物料：

```typescript
import { createEasyEditor } from '@easy-editor/core'
import Button from './materials/button/component'
import ButtonMeta from './materials/button/meta'

const editor = createEasyEditor({
  components: {
    Button
  },
  componentMetas: {
    Button: ButtonMeta
  }
})
```

### 在渲染器中使用

```tsx
import { ReactRenderer } from '@easyeditor/react-renderer-dashboard'

function Preview() {
  return (
    <ReactRenderer
      components={components}
      schema={{
        componentName: 'Button',
        props: {
          content: '点击我',
          type: 'primary',
          onClick: () => console.log('按钮被点击')
        }
      }}
    />
  )
}
```

通过以上步骤，您可以轻松地创建和注册自定义物料，以扩展 EasyEditor 的功能。请根据项目需求调整组件的配置和元数据，以实现最佳效果。

## 下一步

- 了解更多[物料配置选项](/api/material-api)
- 探索[高级物料开发](/guide/advanced-material)
- 查看[物料最佳实践](/guide/material-best-practices)
