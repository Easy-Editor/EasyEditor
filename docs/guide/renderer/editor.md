# 使用设计态

设计态渲染器主要用于可视化编辑器中，提供实时预览和编辑能力。本文将以 React Dashboard 为例，介绍如何使用设计态渲染器。

## Simulator 核心能力

Simulator（模拟器）是连接设计器和渲染器的桥梁，是设计态渲染的核心。它主要负责：

1. **环境隔离**
   - 提供独立的 iframe 运行环境
   - 确保组件在安全的沙箱中运行
   - 避免样式和全局变量污染

2. **状态管理**
   - 维护组件树的渲染状态
   - 管理组件的选中、悬停状态
   - 处理组件间的通信和事件

3. **设计态能力**
   - 组件拖拽和放置
   - 实时预览和属性更新
   - 画布缩放和对齐参考线
   - 组件尺寸调整

4. **多设备适配**
   - 支持不同设备的预览模式
   - 响应式布局的实时展示
   - 设备视口的模拟

## 快速开始

### 安装依赖

```bash
# 安装核心依赖
pnpm add mobx mobx-react
pnpm add @easy-editor/core @easy-editor/plugin-dashboard @easy-editor/react-renderer-dashboard
```

### 基础使用

1. 初始化编辑器实例

```typescript
import { createEditor } from '@easy-editor/core'
import DashboardPlugin from '@easy-editor/plugin-dashboard'

export const editor = createEasyEditor({
  plugins: [DashboardPlugin()],
  setters,        // 属性设置器
  components,     // 组件列表
  componentMetas, // 组件元数据
})

// 获取模拟器实例
export const simulator = await editor.onceGot<Simulator>('simulator')
```

2. 使用渲染器

```typescript
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
import { observer } from 'mobx-react'

const DesignView = observer(() => {
  return (
    <SimulatorRenderer
      host={simulator}
      bemTools={{
        detecting: true,    // 组件悬停检测
        resizing: true,     // 组件尺寸调整
        selecting: true,    // 组件选中
        guideLine: true,    // 对齐参考线
        extra: <CustomTools /> // 自定义工具栏
      }}
    />
  )
})
```

## 多页面路由

设计态渲染器内置了路由系统，基于 `react-router` 实现。每个页面文档都会被自动注册为一个路由，路由路径与文档的 `fileName` 对应。

### 路由规则

- 默认路由：`/` - 指向项目的首页
- 页面路由：`/${fileName}` - 对应每个文档的路由路径
  - `fileName`: 文档的文件名，在创建文档时指定

### 路由跳转

```typescript
// 基础跳转：跳转到指定文档
simulator.context.utils.router.navigate('/home')

// 替换当前路由：不新增历史记录
simulator.context.utils.router.navigate('/detail', {
  replace: true  // 替换当前历史记录
})
```

### 自动路由同步

当在设计器中切换当前文档时，路由会自动同步更新：

```typescript
// 内部实现逻辑
const path = simulator.host.project.currentDocument
  ? `/${currentDocument.fileName}`  // 当前文档路径
  : '/'                            // 默认路径
```

这样可以确保设计器的文档状态和路由始终保持一致。

## 布局配置

设计态渲染器支持自定义布局配置，这个布局会作用于整个渲染器的最外层，包裹所有的页面内容。

### 布局结构

```typescript
interface Layout {
  // 方式一：直接传入组件
  Component?: React.ComponentType
  // 方式二：通过组件名引用
  componentName?: string
  // 布局组件的属性
  props?: Record<string, any>
}
```

### 配置方式

```typescript
const CustomLayout: React.FC<React.PropsWithChildren> = ({ children }) => {
  return (
    <div className="custom-layout">
      <header>自定义头部</header>
      <main>{children}</main>
      <footer>自定义底部</footer>
    </div>
  )
}

// 方式一：直接传入组件
<SimulatorRenderer
  host={simulator}
  layout={{
    Component: CustomLayout,
    props: {
      theme: 'dark',
      // 其他属性...
    }
  }}
/>

// 方式二：通过组件名引用
<SimulatorRenderer
  host={simulator}
  layout={{
    componentName: 'CustomLayout',
    props: {
      theme: 'dark',
      // 其他属性...
    }
  }}
/>
```

### 渲染过程

渲染器会按以下顺序处理布局：

1. 最外层是路由容器（HistoryRouter）
2. 其次是自定义布局（Layout）
3. 最后是页面内容（RouteList）

```typescript
// 内部渲染结构
<HistoryRouter>
  <Layout>      {/* 自定义布局 */}
    <RouteList> {/* 页面内容 */}
  </Layout>
</HistoryRouter>
```

### 注意事项

1. 布局组件必须接收并渲染 `children` 属性
2. 如果没有配置布局，将直接渲染页面内容
3. 使用 `componentName` 方式时，确保组件已在 simulator 中注册

## API 参考

### SimulatorRenderer

设计态渲染器的主要组件，用于渲染和管理可视化编辑器中的内容。

#### Props

| 参数 | 说明 | 类型 | 默认值 |
|------|------|------|--------|
| host | 模拟器实例，用于管理组件的渲染状态 | `Simulator` | - |
| bemTools | 编辑器工具配置，可以是布尔值或配置对象 | `boolean \| BEMTools` | `true` |

#### BEMTools

编辑器工具的详细配置选项：

| 参数 | 说明 | 类型 | 默认值 |
|------|------|------|--------|
| detecting | 是否启用组件悬停检测功能 | `boolean` | `true` |
| resizing | 是否启用组件尺寸调整功能 | `boolean` | `true` |
| selecting | 是否启用组件选中功能 | `boolean` | `true` |
| guideLine | 是否显示参考线 | `boolean` | `true` |
| extra | 自定义工具栏额外内容 | `ReactNode` | - |

## 样式定制

设计态渲染器提供了丰富的 CSS 变量，可以通过覆盖这些变量来自定义主题样式。

### 变量说明

```css
:root {
  /* 品牌色系列 */
  --brand-color: #1890ff;
  --brand-color-1: rgba(0, 108, 255, 1);
  --brand-color-2: rgba(25, 122, 255, 1);
  --brand-color-3: rgba(0, 96, 229, 1);

  /* 画布相关 */
  --color-canvas-background: rgba(31, 56, 88, 0.06);
  --color-canvas-detecting-background: rgba(24, 144, 255, 0.04);

  /* 工具相关 */
  --color-guideline: rgba(235, 86, 72, 1);
  --color-icon-normal: var(--normal-alpha-4);
  --color-icon-hover: var(--normal-alpha-3);

  /* 文本颜色 */
  --color-text: var(--dark-alpha-3);
  --color-text-light: rgba(0, 0, 0, 0.5);

  /* ... */
}
```

### 定制案例

以下是一个完整的暗色主题定制案例：

```typescript
// 在你的项目中创建 theme.css
import './theme.css'

// theme.css
:root {
  /* 修改主题色为紫色系 */
  --brand-color: #7546c9;
  --brand-color-1: rgba(117, 70, 201, 1);
  --brand-color-2: rgba(137, 90, 221, 1);
  --brand-color-3: rgba(97, 50, 181, 1);

  /* 暗色画布背景 */
  --color-canvas-background: rgba(24, 24, 28, 1);
  --color-canvas-detecting-background: rgba(117, 70, 201, 0.1);

  /* 调整工具颜色 */
  --color-guideline: rgba(117, 70, 201, 1);
  --color-icon-normal: rgba(255, 255, 255, 0.45);
  --color-icon-hover: rgba(255, 255, 255, 0.85);

  /* 亮色文本 */
  --color-text: rgba(255, 255, 255, 0.85);
  --color-text-light: rgba(255, 255, 255, 0.45);

  /* 组件选中和激活状态 */
  --color-block-background-active: var(--brand-color-1);
  --color-block-background-active-light: rgba(117, 70, 201, 0.1);

  /* ... */
}
```

### 使用建议

1. 创建独立的主题文件，便于管理和切换
2. 使用 CSS 变量可以实现动态主题切换
3. 注意保持颜色的对比度，确保可访问性
4. 可以使用 CSS 预处理器（如 SCSS）管理变量

## 最佳实践

1. **性能优化**
   - 使用 `mobx-react` 的 `observer` 包裹组件以确保响应式更新
   - 合理控制组件的重绘时机
   - 大量组件时建议使用虚拟滚动

2. **样式隔离**
   - 使用 CSS Modules 或 CSS-in-JS 方案
   - 避免全局样式污染

3. **生命周期管理**
   - 确保在组件卸载时清理相关事件监听
   - 注意资源的及时释放

## 下一步

- 了解如何[使用运行态渲染器](/guide/renderer/live-mode)
- 探索如何[自定义渲染器](/guide/renderer/custom)
- 查看[渲染器 API 参考](/api/renderer)
