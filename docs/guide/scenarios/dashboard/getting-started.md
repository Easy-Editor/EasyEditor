# 快速开始

本指南将帮助你快速搭建一个基于 EasyEditor 的大屏设计应用。

## 环境准备

确保你的开发环境满足以下要求：

- [Node.js](https://nodejs.org/) 18 及以上版本。
- [pnpm](https://pnpm.io/) 9.12.2 及以上版本。

::: info 提示
强烈建议使用 pnpm 作为包管理器，同时 EasyEditor 的依赖管理也限制为仅支持 pnpm 安装。
:::

## 安装依赖

```bash
# 安装核心依赖
pnpm add @easy-editor/core @easy-editor/plugin-dashboard @easy-editor/react-renderer @easy-editor/react-renderer-dashboard

# 安装运行时依赖
pnpm add mobx mobx-react
```

## 使用

### 创建编辑器实例

在项目中创建 `src/editor/index.ts` 文件：

```ts
import { createEditor } from '@easy-editor/core'
import DashboardPlugin from '@easy-editor/plugin-dashboard'

// 创建编辑器实例
export const editor = createEditor({
  plugins: [DashboardPlugin()],
  // 配置组件物料与元数据
})

// 获取核心模块
export const designer = await editor.onceGot('designer')
export const project = await editor.onceGot('project')
export const simulator = await editor.onceGot('simulator')
```

### 设计态渲染器

设计态渲染器用于在编辑器中进行可视化设计：

```tsx
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
import { simulator } from '@/editor'

export const DesignRenderer = () => {
  return (
    <div className='h-full w-full'>
      <SimulatorRenderer host={simulator} />
    </div>
  )
}
```

### 运行态渲染器

运行态渲染器用于预览或部署时的渲染：

```tsx
import { components } from '@/editor/materials'
import { getPageSchemaFromLocalStorage } from '@/lib/schema'
import { Renderer } from '@easy-editor/react-renderer-dashboard'

const Preview = () => {
  // 获取页面 Schema
  const schema = getPageSchemaFromLocalStorage('home')?.componentsTree[0]

  return (
    <div className='h-full w-full'>
      {schema && (
        <Renderer
          schema={schema}
          components={components}
          viewport={{ width: 1920, height: 1080 }}
        />
      )}
    </div>
  )
}
```

### 物料面板

物料面板用于展示可拖拽的组件和模板：

```tsx
import { simulator } from '@/editor'
import type { Snippet } from '@easy-editor/core'
import { useEffect, useRef } from 'react'

// 单个物料项
const SnippetItem = ({ snippet }: { snippet: Snippet }) => {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // 将物料与 DOM 元素关联，使其可拖拽
    const unlink = simulator.linkSnippet(ref.current!, snippet)
    return () => unlink()
  }, [snippet])

  return (
    <div ref={ref} className='cursor-move'>
      <span>{snippet.title}</span>
    </div>
  )
}

// 物料分类列表
export const MaterialList = ({ snippets }) => {
  return (
    <div>
      {Object.entries(snippets).map(([category, items]) => (
        <div key={category}>
          <h3>{category}</h3>
          <div>
            {items.map(snippet => (
              <SnippetItem key={snippet.id} snippet={snippet} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
```

### 大纲树

大纲树用于查看和管理组件结构：

```tsx
import { designer, project } from '@/editor'
import type { Node } from '@easy-editor/core'
import { observer } from 'mobx-react'

export const OutlineTree = observer(({ node }) => {
  const selected = designer.selection.getTopNodes(true)

  const handleSelect = () => {
    if (node.canSelect()) {
      node.select()
    }
  }

  return (
    <div>
      <div
        onClick={handleSelect}
        className={selected.includes(node) ? 'selected' : ''}
      >
        {node.componentName}

        {!node.isRoot && (
          <>
            <button onClick={() => node.hide(!node.isHidden)}>
              {node.isHidden ? '显示' : '隐藏'}
            </button>
            <button onClick={() => node.lock(!node.isLocked)}>
              {node.isLocked ? '解锁' : '锁定'}
            </button>
          </>
        )}
      </div>

      {node.childrenNodes?.length > 0 && (
        <div style={{ marginLeft: '20px' }}>
          {node.childrenNodes.map((child, index) => (
            <OutlineTree key={index} node={child} />
          ))}
        </div>
      )}
    </div>
  )
})
```

### 属性配置面板

属性配置面板用于编辑选中组件的属性：

```tsx
import { editor } from '@/editor'
import { customFieldItem } from '@/editor/setters'
import { SettingRender } from '@easy-editor/react-renderer'
import { observer } from 'mobx-react'

export const ConfigurePanel = observer(() => {
  return (
    <div className="h-full w-full">
      <div className="p-2 font-medium border-b">属性配置</div>
      <div className="p-2">
        <SettingRender editor={editor} customFieldItem={customFieldItem} />
      </div>
    </div>
  )
})
```

自定义设置器配置示例 (`src/editor/setters.ts`):

```ts
import type { CustomFieldItemProps } from '@easy-editor/react-renderer'

// 自定义设置器组件
export const customFieldItem: CustomFieldItemProps = {
  // 可以根据属性名或类型自定义不同的设置器组件
  component: (props) => {
    // 自定义属性编辑组件
    const { value, onChange, schema } = props

    // 示例：为特定属性提供自定义设置器
    if (schema.field === 'specialFormat') {
      return (
        <div>
          <input
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )
    }

    // 返回 null 表示使用默认设置器
    return null
  }
}
```

## 示例项目

完整的大屏设计案例可在 [EasyDashboard](https://github.com/Easy-Editor/EasyDashboard) 项目中找到，其中包含了：

1. **组件拖拽** - 从物料面板拖拽组件到画布
2. **组件编辑** - 调整组件属性、位置和大小
3. **大纲树** - 查看和管理组件结构
4. **页面预览** - 实时预览大屏效果、
5. ...
