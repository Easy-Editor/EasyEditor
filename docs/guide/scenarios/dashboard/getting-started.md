# 快速开始

本指南将帮助你快速搭建一个基于 EasyEditor 的大屏设计应用。

## 环境准备

确保你的开发环境满足以下要求：

- [Node.js](https://nodejs.org/) 18.12.0 及以上版本。
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

### 初始化编辑器

先在 `src/editor/runtime.ts` 中创建唯一的 Dashboard 引擎实例：

```ts
import { type EngineInstance, createEngine } from '@easy-editor/core/instance'

export const engine: EngineInstance = createEngine({
  // DashboardPlugin 仍依赖同 Realm 原型扩展。
  trustPolicy: 'legacyTrusted',
  hostWindow: window,
})

export const project = engine.project
```

然后在 `src/editor/index.ts` 中导出一个可等待的启动函数。所有启动副作用都放在 `try` 中；如果启动失败，先销毁已经创建的部分资源。如果启动错误与清理错误同时发生，用 `AggregateError` 保留两条错误链：

```ts
import {
  type ProjectSchema,
  validateProjectSchema,
} from '@easy-editor/core/instance'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import { Group, componentMetaMap } from './materials'
import { engine } from './runtime'
import { setterMap } from './setters'

let releaseSimulatorReady: (() => void) | undefined

export async function destroyEditor(): Promise<void> {
  const cleanupErrors: unknown[] = []
  const release = releaseSimulatorReady
  releaseSimulatorReady = undefined
  try {
    release?.()
  } catch (error) {
    cleanupErrors.push(error)
  }
  try {
    await engine.destroy()
  } catch (error) {
    cleanupErrors.push(error)
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Editor cleanup failed')
  }
}

export async function bootstrapEditor(schema: ProjectSchema): Promise<void> {
  try {
    await engine.plugins.registerPlugins([
      DashboardPlugin({
        group: {
          meta: Group,
          initSchema: {
            componentName: 'Group',
            title: '分组',
            isGroup: true,
          },
        },
      }),
    ])

    engine.materials.buildComponentMetasMap(Object.values(componentMetaMap))
    engine.setters.registerSetter(setterMap)
    await engine.init({ designMode: 'design' })

    releaseSimulatorReady = engine.project.onSimulatorReady(simulator => {
      simulator.set('deviceStyle', {
        viewport: { width: 1920, height: 1080 },
      })
    })

    const validated = validateProjectSchema(schema, engine.trustPolicy)
    engine.loadProject(validated, true)
  } catch (startupError) {
    try {
      await destroyEditor()
    } catch (cleanupError) {
      throw new AggregateError(
        [startupError, cleanupError],
        'Editor startup and cleanup both failed',
      )
    }
    throw startupError
  }
}
```

应用入口必须先等待启动完成，再挂载 UI；否则 React/Vue 组件可能在引擎仍处于 `initializing` 时读取 Project：

```ts
import { bootstrapEditor, destroyEditor } from '@/editor/index'
import { getPageSchemaFromLocalStorage } from '@/lib/schema'

const initialSchema = getPageSchemaFromLocalStorage('home')
if (!initialSchema) throw new Error('没有可加载的初始项目 Schema')

await bootstrapEditor(initialSchema)
// bootstrap 成功后再调用 createRoot(...).render(...) 或 app.mount(...)

window.addEventListener('pagehide', event => {
  if (!event.persisted) void destroyEditor().catch(console.error)
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => destroyEditor())
}
```

不要永久缓存已经 settle 的销毁 Promise。`EngineInstance` 自身会合并同一轮并发 `destroy()`；直接返回当前销毁调用，才能保留清理失败后的重试语义。

::: warning 兼容边界
`legacyTrusted` 只用于兼容当前 Dashboard 插件和旧 UMD 资源，不提供沙箱隔离。Agent 或其他不可信运行时应通过 Worker/iframe capability 边界访问宿主，不应获得 `engine.project` 或 Node 引用。
:::

### 设计态渲染器

设计态渲染器用于在编辑器中进行可视化设计：

```tsx
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
import { engine } from '@/editor/runtime'

export const DesignRenderer = () => {
  return (
    <div className='h-full w-full'>
      <SimulatorRenderer designer={engine.designer} />
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
import { project } from '@/editor/runtime'
import type { Snippet } from '@easy-editor/core/instance'
import { useEffect, useRef } from 'react'

// 单个物料项
const SnippetItem = ({ snippet }: { snippet: Snippet }) => {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // 将物料与 DOM 元素关联，使其可拖拽
    const unlink = project.simulator?.linkSnippet(ref.current!, snippet)
    return () => unlink?.()
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
import { project } from '@/editor/runtime'
import type { Node } from '@easy-editor/core/instance'
import { observer } from 'mobx-react'

export const OutlineTree = observer(({ node }) => {
  const { designer } = project
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
import { project } from '@/editor/runtime'
import { customFieldItem } from '@/editor/setters'
import { SettingRender } from '@easy-editor/react-renderer'
import { observer } from 'mobx-react'

export const ConfigurePanel = observer(() => {
  return (
    <div className="h-full w-full">
      <div className="p-2 font-medium border-b">属性配置</div>
      <div className="p-2">
        <SettingRender designer={project.designer} customFieldItem={customFieldItem} />
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
