# Renderer

渲染器是 EasyEditor 将组件树（schema）渲染为实际 UI 界面的核心模块。它提供了将组件元数据和属性转换为实际 DOM 元素的功能，是连接编辑器设计系统与最终渲染结果的桥梁。

## Renderer

```tsx
import { rendererFactory } from '@easyeditor/react-renderer';
const Renderer = rendererFactory()

function App() {
  return (
    <Renderer
      schema={schema}
      components={components}
    />
  );
}
```

## components

- 类型: `Record<string, React.ComponentType<any>>`
- 默认值: `{}`
- 描述: 注册到渲染器的组件映射表

```tsx
import Button from './components/Button';
import Input from './components/Input';
import Form from './components/Form';

function App() {
  return (
    <Renderer
      schema={schema}
      components={{
        Button,
        Input,
        Form
      }}
    />
  );
}
```

## designMode

- 类型: `'live' | 'design' | undefined`
- 默认值: `'live'`
- 描述: 渲染器的工作模式，`'live'` 表示运行时模式，`'design'` 表示设计时模式

```tsx
function App() {
  return (
    <Renderer
      schema={schema}
      components={components}
      designMode="live" // 运行时模式
    />
  );
}
```

## className

- 类型: `string`
- 默认值: `undefined`
- 描述: 渲染器根节点的 CSS 类名

```tsx
function App() {
  return (
    <Renderer
      schema={schema}
      components={components}
      className="my-renderer"
    />
  );
}
```

## style

- 类型: `React.CSSProperties`
- 默认值: `undefined`
- 描述: 渲染器根节点的样式

```tsx
function App() {
  return (
    <Renderer
      schema={schema}
      components={components}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
```

## appHelper

- 类型: `RendererAppHelper`
- 默认值: `undefined`
- 描述: 渲染器的全局上下文，可以在组件中通过 `this` 访问

```tsx
const appHelper = {
  utils: {
    formatDate: (date) => {
      return new Date(date).toLocaleDateString();
    }
  },
  constants: {
    API_URL: 'https://api.example.com'
  }
};

function App() {
  return (
    <Renderer
      schema={schema}
      components={components}
      appHelper={appHelper}
    />
  );
}
```

## device

- 类型: `'default' | 'pc' | 'mobile' | string`
- 默认值: `'default'`
- 描述: 渲染器的设备类型，用于响应式渲染

```tsx
function App() {
  return (
    <Renderer
      schema={schema}
      components={components}
      device="mobile"
    />
  );
}
```

## notFoundComponent

- 类型: `React.ComponentType<NotFoundComponentProps>`
- 默认值: 内置的 NotFoundComponent
- 描述: 当找不到组件时显示的组件

```tsx
const CustomNotFoundComponent = ({ componentName }) => {
  return <div className="custom-not-found">组件 {componentName} 未找到</div>;
};

function App() {
  return (
    <Renderer
      schema={schema}
      components={components}
      notFoundComponent={CustomNotFoundComponent}
    />
  );
}
```

## faultComponent

- 类型: `React.ComponentType<FaultComponentProps>`
- 默认值: 内置的 FaultComponent
- 描述: 当组件渲染异常时显示的组件

```tsx
const CustomFaultComponent = ({ componentName, error }) => {
  return (
    <div className="custom-fault">
      <h3>组件 {componentName} 渲染错误</h3>
      <p>{error.message}</p>
    </div>
  );
};

function App() {
  return (
    <Renderer
      schema={schema}
      components={components}
      faultComponent={CustomFaultComponent}
    />
  );
}
```

## documentId

- 类型: `string`
- 默认值: `undefined`
- 描述: 当前文档的 ID，在多文档模式下使用

```tsx
function App() {
  return (
    <Renderer
      schema={schema}
      components={components}
      documentId="page1"
    />
  );
}
```

## suspended

- 类型: `boolean`
- 默认值: `false`
- 描述: 渲染模块是否挂起，当设置为 true 时，渲染模块最外层容器的 shouldComponentUpdate 将始终返回 false

```tsx
function App() {
  return (
    <Renderer
      schema={schema}
      components={components}
      suspended={false}
    />
  );
}
```

## onCompGetRef

- 类型: `(schema: NodeSchema, ref: any) => void`
- 默认值: `undefined`
- 描述: 组件获取 ref 时触发的钩子

```tsx
function App() {
  const handleCompGetRef = (schema, ref) => {
    console.log(`组件 ${schema.id} 的 ref:`, ref);
  };

  return (
    <Renderer
      schema={schema}
      components={components}
      onCompGetRef={handleCompGetRef}
    />
  );
}
```

## getSchemaChangedSymbol

- 类型: `() => boolean`
- 默认值: `undefined`
- 描述: 获取 schema 是否有变更的标志

```tsx
import { useState } from 'react';

function App() {
  const [schemaChanged, setSchemaChanged] = useState(false);

  return (
    <Renderer
      schema={schema}
      components={components}
      getSchemaChangedSymbol={() => schemaChanged}
      setSchemaChangedSymbol={(value) => setSchemaChanged(value)}
    />
  );
}
```

## setSchemaChangedSymbol

- 类型: `(symbol: boolean) => void`
- 默认值: `undefined`
- 描述: 设置 schema 是否有变更的标志

```tsx
// 见上方示例
```

## getNode

- 类型: `(id: string) => Node`
- 默认值: `undefined`
- 描述: 获取节点的方法

```tsx
function App() {
  // 假设 document 是当前文档实例
  return (
    <Renderer
      schema={schema}
      components={components}
      getNode={(id) => document.getNode(id)}
    />
  );
}
```

## enableStrictNotFoundMode

- 类型: `boolean`
- 默认值: `false`
- 描述: 当开启组件未找到严格模式时，渲染模块不会默认给一个容器组件

```tsx
function App() {
  return (
    <Renderer
      schema={schema}
      components={components}
      enableStrictNotFoundMode={true}
    />
  );
}
```

## excuteLifeCycleInDesignMode

- 类型: `boolean`
- 默认值: `false`
- 描述: 是否在设计模式下执行生命周期方法

```tsx
function App() {
  return (
    <Renderer
      schema={schema}
      components={components}
      designMode="design"
      excuteLifeCycleInDesignMode={true}
    />
  );
}
```

## 解析 JSExpression

渲染器支持在 schema 的属性中使用表达式：

```tsx
const schema = {
  componentName: 'Button',
  props: {
    onClick: {
      type: 'JSExpression',
      value: 'function() {alert("Hello!")}'
    },
    disabled: {
      type: 'JSExpression',
      value: 'this.data.loading'
    }
  },
  children: '提交'
};

function App() {
  return <Renderer schema={schema} components={components} />;
}
```

表达式中的 `this` 指向渲染器的上下文，包含以下属性：

- `this.utils`: 工具方法
- `this.constants`: 常量
- `this.data`: 组件数据
- `this.state`: 组件状态

## 事件处理

渲染器支持在 schema 中定义事件处理器：

```tsx
const schema = {
  componentName: 'Form',
  props: {
    onSubmit: {
      type: 'JSFunction',
      value: `function(values) {
        console.log('表单提交:', values);
        this.utils.request('/api/submit', {
          method: 'POST',
          data: values
        });
      }`
    }
  },
  children: [
    // 表单项
  ]
};

function App() {
  return <Renderer schema={schema} components={components} />;
}
```

事件处理器可以访问渲染器上下文，以及组件传递的参数。
