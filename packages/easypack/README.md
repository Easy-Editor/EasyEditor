# @easy-editor/easypack

EasyEditor 生态统一构建工具，用于 Materials 和 Setters 的打包构建。

## 安装

```bash
pnpm add -D @easy-editor/easypack
```

## 快速开始

### 1. 初始化配置

```bash
easypack init
```

选择预设类型：
- `material` - 物料组件
- `setter` - 设置器
- `library` - 通用库

### 2. 构建

```bash
easypack build
```

### 3. 开发服务器

```bash
easypack dev
```

## 配置文件

创建 `easypack.config.ts`：

```typescript
export default {
  preset: 'material',
  globalName: 'EasyEditorMaterialsText',
  dev: {
    port: 5001,
  },
}
```

## 预设

### material

适用于 EasyMaterials 物料组件。

**默认配置：**
- 入口：`src/index.tsx`, `src/meta.ts`, `src/component.tsx`
- 输出：`index.min.js`, `meta.min.js`, `component.min.js`
- CSS：注入到 JS 中
- JSX：automatic

### setter

适用于 EasySetters 设置器包。

**默认配置：**
- 入口：`src/index.ts`
- 输出：`index.min.js`
- CSS：提取为 `index.css`
- JSX：classic
- 外部依赖：包含 `@easy-editor/core`

### library

适用于通用 React 库。

**默认配置：**
- 入口：`src/index.ts`
- 输出：`index.min.js`
- CSS：注入到 JS 中
- JSX：automatic

## 配置选项

```typescript
interface EasypackConfig {
  // 预设类型
  preset: 'material' | 'setter' | 'library'

  // UMD 全局变量名
  globalName?: string

  // 入口文件
  entry?: {
    main?: string      // 主入口
    meta?: string      // 元数据入口 (material)
    component?: string // 组件入口 (material)
  }

  // 输出配置
  output?: {
    dir?: string       // 输出目录，默认 'dist'
    esm?: boolean      // ESM 格式
    cjs?: boolean      // CJS 格式
    umd?: boolean      // UMD 格式，默认 true
    minify?: boolean   // 压缩，默认 true
    sourcemap?: boolean // Sourcemap
    types?: boolean    // TypeScript 声明
  }

  // 外部依赖
  external?: {
    externals?: string[]              // 外部依赖列表
    globals?: Record<string, string>  // UMD 全局变量映射
  }

  // CSS 配置
  css?: {
    scopedName?: string      // CSS Modules 类名格式
    mode?: 'inject' | 'extract'  // 注入或提取
    extractFilename?: string // 提取文件名
  }

  // JSX 运行时
  jsxRuntime?: 'automatic' | 'classic'

  // 路径别名
  alias?: Record<string, string>

  // 开发服务器
  dev?: {
    port?: number
    materialApi?: boolean
  }
}
```

## 输出格式

| 配置 | 输出文件 |
|------|---------|
| `umd: true, minify: true` | `index.min.js` |
| `umd: true, minify: false` | `index.js` |
| `esm: true, minify: true` | `index.min.esm.js` |
| `esm: true, minify: false` | `index.esm.js` |
| `cjs: true, minify: true` | `index.min.cjs` |
| `cjs: true, minify: false` | `index.cjs` |

## 示例

### 物料组件

```typescript
// easypack.config.ts
export default {
  preset: 'material',
  dev: {
    port: 5003,
  },
}
```

### 设置器

```typescript
// easypack.config.ts
export default {
  preset: 'setter',
  globalName: 'EasyEditorSetters',
}
```

### 多格式输出

```typescript
// easypack.config.ts
export default {
  preset: 'library',
  globalName: 'MyLibrary',
  output: {
    esm: true,
    cjs: true,
    umd: true,
    minify: true,
    sourcemap: true,
    types: true,
  },
}
```

### 自定义外部依赖

```typescript
// easypack.config.ts
export default {
  preset: 'library',
  external: {
    externals: ['react', 'react-dom', 'lodash'],
    globals: {
      lodash: '_',
    },
  },
}
```

## CLI 命令

```bash
# 构建
easypack build

# 开发服务器
easypack dev

# 初始化配置
easypack init

# 指定配置文件
easypack build -c custom.config.ts

# 查看帮助
easypack --help

# 查看版本
easypack --version
```

## License

MIT
