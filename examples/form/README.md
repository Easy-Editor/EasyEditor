# React + Dashboard

# EasyEditor 表单示例

这是一个基于 EasyEditor 的低代码表单构建器示例，集成了 `plugin-form` 和 `react-renderer-form`。

## 功能特性

### 🚀 核心功能
- **表单构建器**: 可视化拖拽构建表单
- **表单验证**: 支持字段级和表单级验证
- **数据管理**: 自动收集和管理表单数据
- **状态管理**: 完整的表单状态跟踪
- **自定义提交**: 支持自定义表单提交处理

### 📋 表单组件
- **表单容器** (FormContainer): 表单的根容器
- **输入框** (Input): 支持文本、邮箱、密码、数字类型
- **按钮** (Button): 支持提交、重置、普通按钮
- **选择框** (Select): 下拉选择组件
- **文本域** (Textarea): 多行文本输入
- **复选框** (Checkbox): 单个选择组件
- **单选框组** (Radio): 多选一组件

### 🔧 验证系统
支持多种验证规则：
- `required`: 必填验证
- `minLength`: 最小长度
- `maxLength`: 最大长度
- `pattern`: 正则表达式
- `email`: 邮箱格式
- `number`: 数字验证
- `custom`: 自定义验证函数

## 开始使用

### 1. 安装依赖
```bash
pnpm install
```

### 2. 启动开发服务器
```bash
pnpm dev
```

### 3. 打开浏览器
访问 `http://localhost:5173` 开始使用表单构建器

## 项目结构

```
src/
├── editor/                    # 编辑器配置
│   ├── index.ts              # 插件注册和初始化
│   ├── materials/            # 材料组件
│   │   ├── form/             # 表单组件
│   │   │   ├── form-container/
│   │   │   ├── input/
│   │   │   ├── button/
│   │   │   ├── select/
│   │   │   ├── textarea/
│   │   │   ├── checkbox/
│   │   │   └── radio/
│   │   └── ...
│   └── ...
├── pages/                    # 页面组件
│   ├── editor/              # 编辑器页面
│   └── preview/             # 预览页面
└── ...
```

## 核心配置

### 表单插件配置
```typescript
FormPlugin({
  formConfig: {
    enableValidation: true,      // 启用验证
    enableAutoSave: true,        // 启用自动保存
    validationMode: 'onChange',  // 验证模式
  },
  customSubmitHandler: async (formData, node) => {
    console.log('Form submitted:', formData)
    return { success: true, message: '表单提交成功！' }
  },
})
```

### 渲染器配置
```typescript
<Renderer
  schema={schema}
  components={components}
  viewport={{ width: 800, height: 600 }}
  formConfig={{
    theme: 'default',
    layout: 'vertical',
    size: 'default'
  }}
/>
```

## 表单 API

### 表单数据操作
```typescript
// 获取表单数据
const formData = document.getFormData()

// 设置表单数据
document.setFormData({ name: '张三', email: 'test@example.com' })

// 验证表单
const result = await document.validateForm()

// 提交表单
const submitResult = await document.submitForm()

// 重置表单
document.resetForm()
```

### 字段操作
```typescript
// 获取字段值
const value = node.getFieldValue()

// 设置字段值
node.setFieldValue('新值')

// 验证字段
const isValid = await node.validateField()

// 添加验证规则
node.addValidationRule({
  type: 'required',
  message: '此字段为必填项'
})
```

## 自定义组件

### 创建新的表单组件
1. 在 `src/editor/materials/form/` 下创建组件目录
2. 创建 `component.tsx` 和 `meta.ts` 文件
3. 在 `src/editor/materials/component.ts` 和 `meta.ts` 中导入并导出

### 组件示例
```typescript
// component.tsx
import type { FC } from 'react'

export interface CustomFieldProps {
  name?: string
  value?: string
  onChange?: (value: string) => void
}

const CustomField: FC<CustomFieldProps> = ({ name, value, onChange }) => {
  return (
    <input
      name={name}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      className="custom-field"
    />
  )
}

export default CustomField
```

## 开发工具

### 格式化代码
```bash
pnpm format
```

### 代码检查
```bash
pnpm lint
```

### 构建项目
```bash
pnpm build
```

## 技术栈

- **EasyEditor Core**: 低代码引擎核心
- **Plugin Form**: 表单插件
- **React Renderer Form**: React 表单渲染器
- **React 19**: UI 框架
- **TypeScript**: 类型系统
- **Tailwind CSS**: 样式框架
- **MobX**: 状态管理
- **Vite**: 构建工具

## 许可证

MIT License
