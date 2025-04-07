# 物料扩展

物料是 EasyEditor 中可以被拖拽使用的最小组件单元。本文将介绍如何开发和注册自定义物料。

## 物料结构

一个完整的物料包含以下文件：

```bash
button/
├── component.tsx    # 物料组件
├── configure.ts     # 物料配置
├── meta.ts          # 物料元数据
└── snippets.ts      # 物料预设
```

## 开发物料

### 1. 创建组件 (component.tsx)

在 `component.tsx` 文件中定义物料的核心组件：

```tsx
import { type Ref } from 'react'

interface ButtonProps {
  ref: Ref<HTMLButtonElement>
  content: string
}

const Button = (props: ButtonProps) => {
  return (
    <button
      ref={props.ref}
      type='button'
      className='w-full h-full'
    >
      {props.content}
    </button>
  )
}

export default Button
```

### 2. 配置组件属性 (configure.ts)

在 `configure.ts` 文件中配置组件的属性：

```typescript
import type { Configure } from '@easy-editor/core'
import Button from './component'

const configure: Configure = {
  props: [
    {
      type: 'group',
      title: '功能',
      setter: 'GroupSetter',
      items: [
        {
          type: 'field',
          name: 'content',
          title: '内容',
          setter: 'StringSetter'
        }
      ]
    }
  ]
}

export default configure
```

:::info
有关 Configure 的详细配置，可以查看 [Configure API](#)
:::

### 3. 定义组件元数据 (meta.ts)

在 `meta.ts` 文件中定义组件的元数据：

```typescript
import type { ComponentMetadata } from '@easy-editor/core'
import configure from './configure'
import snippets from './snippets'

const meta: ComponentMetadata = {
  componentName: 'Button',    // 物料名称
  title: '按钮',              // 物料标题
  category: '通用',           // 物料分类
  snippets,                  // 物料预设
  configure                  // 物料配置
}

export default meta
```

:::info
有关 Meta 的详细配置，可以查看 [Meta API](#)
:::

### 4. 创建组件预设 (snippets.ts)

在 `snippets.ts` 文件中创建组件的预设示例：

```typescript
import type { Snippet } from '@easy-editor/core'

const snippets: Snippet[] = [
  {
    title: '主按钮',
    schema: {
      componentName: 'Button',
      props: {
        content: '主按钮'
      },
    }
  },
  {
    title: '次按钮',
    schema: {
      componentName: 'Button',
      props: {
        content: '次按钮'
      }
    }
  }
]

export default snippets
```

## 注册物料

在编辑器初始化时注册物料：

```typescript
import { createEasyEditor } from '@easy-editor/core'
import ButtonMeta from './materials/button/meta'

const editor = createEasyEditor({
  componentMetas: {
    Button: ButtonMeta
  }
})
```

## 使用

最终，在 Renderer 渲染器中使用物料：

```tsx
import { ReactRenderer } from '@easyeditor/react-renderer-dashboard'

<ReactRenderer
  components={components}
  schema={{
    componentName: 'Button',
    props: {
      content: 'Button in Root',
    },
  }}
/>
```

## 结论

通过以上步骤，您可以轻松地创建和注册自定义物料，以扩展 EasyEditor 的功能。请根据项目需求调整组件的配置和元数据，以实现最佳效果。
