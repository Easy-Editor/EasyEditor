# Renderer

`Renderer` 是 EasyEditor 提供的基础渲染器，用于纯运行时场景，不包含设计时交互能力。它提供了将组件 schema 渲染为实际 UI 的核心功能。

## 创建渲染器

- 类型: `Renderer`

```ts
import { Renderer } from '@easyeditor/react-renderer-dashboard';
import schema from './schema.json';
import * as components from './components';

// 创建基础渲染器实例
const renderer = new Renderer({
  components,  // 注册组件
});
```

## 配置选项

### components

- 类型: `Record<string, any>`
- 默认值: `{}`

组件映射表，用于将 schema 中的组件名映射到实际的组件实现。

```ts
import { Button, Input, Form } from 'antd';

const renderer = new Renderer({
  components: {
    Button,
    Input,
    Form,
    'Form.Item': Form.Item
  }
});
```

### propHandler

- 类型: `(props: any, schema: any) => any`
- 默认值: `props => props`

组件属性处理器，用于在渲染前处理组件的属性。

```ts
const renderer = new Renderer({
  components,
  propHandler: (props, schema) => {
    // 添加自定义数据属性
    return {
      ...props,
      'data-node-id': schema.id,
      'data-component': schema.componentName
    };
  }
});
```

### context

- 类型: `any`
- 默认值: `{}`

渲染器上下文，可以在组件中通过上下文访问的数据。

```ts
const renderer = new Renderer({
  components,
  context: {
    theme: 'light',
    user: {
      name: 'User',
      role: 'Admin'
    },
    utils: {
      formatDate: (date) => new Date(date).toLocaleDateString()
    }
  }
});
```

### customRender

- 类型: `(schema: any, props: any) => React.ReactNode`
- 默认值: `undefined`

自定义渲染函数，用于完全控制渲染过程。

```ts
const renderer = new Renderer({
  components,
  customRender: (schema, props) => {
    // 自定义渲染逻辑
    if (schema.componentName === 'CustomComponent') {
      return <div className="custom-wrapper">{/* 自定义渲染 */}</div>;
    }
    // 对于其他组件，使用默认渲染逻辑
    return null;
  }
});
```

## 方法

### renderComponent(schema, props)

- 参数:
  - `schema`: `any` - 要渲染的组件 schema
  - `props`: `any` - 可选，要传递给组件的额外属性
- 返回值: `React.ReactNode`

渲染一个组件。

```ts
// 渲染整个 schema
const renderedComponent = renderer.renderComponent(schema);

// 渲染带有额外属性的组件
const renderedWithProps = renderer.renderComponent(schema, {
  className: 'custom-container',
  style: { margin: '20px' }
});
```

### getComponentDOMNode(id)

- 参数:
  - `id`: `string` - 组件节点 ID
- 返回值: `HTMLElement | null`

获取指定节点 ID 的 DOM 元素。

```ts
// 获取组件 DOM 节点
const domNode = renderer.getComponentDOMNode('button-1');
if (domNode) {
  console.log('DOM 节点:', domNode);
}
```

### getComponentDOMNodes()

- 返回值: `Map<string, HTMLElement>`

获取所有组件 ID 到 DOM 元素的映射。

```ts
// 获取所有组件的 DOM 映射
const componentsMap = renderer.getComponentDOMNodes();
console.log('组件数量:', componentsMap.size);
```

### registerComponent(componentName, component)

- 参数:
  - `componentName`: `string` - 组件名称
  - `component`: `any` - 组件实现
- 返回值: `void`

注册单个组件。

```ts
// 注册单个组件
renderer.registerComponent('Button', ButtonComponent);
renderer.registerComponent('CustomCard', CustomCardComponent);
```

### registerComponents(components)

- 参数:
  - `components`: `Record<string, any>` - 组件映射表
- 返回值: `void`

注册多个组件。

```ts
// 注册多个组件
renderer.registerComponents({
  Button: ButtonComponent,
  Input: InputComponent,
  Form: FormComponent,
  'Form.Item': FormItemComponent
});
```

### setContext(context)

- 参数:
  - `context`: `any` - 渲染器上下文
- 返回值: `void`

设置渲染器上下文。

```ts
// 设置上下文
renderer.setContext({
  theme: 'dark',
  user: {
    name: 'Admin',
    role: 'SuperAdmin'
  }
});
```

### destroy()

- 返回值: `void`

销毁渲染器，清理资源。

```ts
// 销毁渲染器
renderer.destroy();
```

## 属性处理

Renderer 会负责处理组件的属性，包括：

### 基础属性传递

将 schema 中的 props 属性传递给组件：

```ts
// schema
{
  componentName: 'Button',
  props: {
    type: 'primary',
    size: 'large',
    disabled: false
  }
}

// 渲染结果
<Button type="primary" size="large" disabled={false} />
```

### 子组件渲染

处理组件的 children 属性：

```ts
// schema
{
  componentName: 'Button',
  props: { type: 'primary' },
  children: '点击我'
}

// 渲染结果
<Button type="primary">点击我</Button>
```

```ts
// 复杂子组件 schema
{
  componentName: 'Card',
  props: { title: '卡片标题' },
  children: [
    {
      componentName: 'Text',
      props: { content: '卡片内容' }
    }
  ]
}

// 渲染结果
<Card title="卡片标题">
  <Text content="卡片内容" />
</Card>
```

### 复杂属性处理

处理特殊类型的属性，如对象和函数：

```ts
// schema
{
  componentName: 'Button',
  props: {
    style: {
      margin: '10px',
      padding: '15px'
    },
    onClick: 'handleClick'
  }
}

// 渲染结果（假设上下文中有 handleClick 函数）
<Button
  style={{ margin: '10px', padding: '15px' }}
  onClick={context.handleClick}
/>
```

## 渲染器上下文使用

组件可以通过 React 的上下文机制访问渲染器提供的上下文：

```tsx
import React, { useContext } from 'react';
import { RendererContext } from '@easyeditor/react-renderer-dashboard';

const MyComponent = (props) => {
  // 获取渲染器上下文
  const context = useContext(RendererContext);

  return (
    <div>
      <h1>当前主题: {context.theme}</h1>
      <p>用户: {context.user.name}</p>
      <p>日期: {context.utils.formatDate(new Date())}</p>
    </div>
  );
};
```

## 示例

### 基本用法

```tsx
import { Renderer } from '@easyeditor/react-renderer-dashboard';
import * as antd from 'antd';
import * as customComponents from './components';

// 创建组件映射
const components = {
  ...antd,
  ...customComponents
};

// 创建 schema
const schema = {
  componentName: 'div',
  props: {
    style: { padding: '20px' }
  },
  children: [
    {
      componentName: 'h1',
      props: {},
      children: '标题'
    },
    {
      componentName: 'Button',
      props: {
        type: 'primary',
        onClick: 'handleClick'
      },
      children: '点击我'
    }
  ]
};

// 创建上下文
const context = {
  handleClick: () => {
    console.log('按钮被点击');
  }
};

// 创建渲染器
const renderer = new Renderer({
  components,
  context
});

// 渲染到 DOM
ReactDOM.render(
  renderer.renderComponent(schema),
  document.getElementById('root')
);
```

### 自定义属性处理

```tsx
import { Renderer } from '@easyeditor/react-renderer-dashboard';
import * as components from './components';

// 创建渲染器
const renderer = new Renderer({
  components,
  propHandler: (props, schema) => {
    const newProps = { ...props };

    // 处理事件绑定
    Object.keys(props).forEach(key => {
      if (key.startsWith('on') && typeof props[key] === 'string') {
        // 从上下文中获取事件处理器
        const handler = context[props[key]];
        if (typeof handler === 'function') {
          newProps[key] = handler;
        } else {
          console.warn(`事件处理器 ${props[key]} 不存在`);
        }
      }
    });

    // 处理条件属性
    if (props.condition === false) {
      newProps.style = { ...(newProps.style || {}), display: 'none' };
    }

    return newProps;
  },
  context: {
    handleClick: () => console.log('Click'),
    handleChange: (value) => console.log('Change:', value)
  }
});

// 使用
const schema = {
  componentName: 'div',
  children: [
    {
      componentName: 'Button',
      props: {
        onClick: 'handleClick',
        condition: false // 这个按钮将被隐藏
      },
      children: '隐藏按钮'
    },
    {
      componentName: 'Input',
      props: {
        onChange: 'handleChange'
      }
    }
  ]
};

// 渲染
renderer.renderComponent(schema);
```

### 动态更新内容

```tsx
import { Renderer } from '@easyeditor/react-renderer-dashboard';
import * as components from './components';

// 初始 schema
let schema = {
  componentName: 'div',
  children: [
    {
      componentName: 'Button',
      props: {
        type: 'primary'
      },
      children: '初始按钮'
    }
  ]
};

// 创建渲染器
const renderer = new Renderer({
  components
});

// 初始渲染
const container = document.getElementById('root');
ReactDOM.render(
  renderer.renderComponent(schema),
  container
);

// 更新 schema
setTimeout(() => {
  schema = {
    componentName: 'div',
    children: [
      {
        componentName: 'Button',
        props: {
          type: 'primary'
        },
        children: '初始按钮'
      },
      {
        componentName: 'Button',
        props: {
          type: 'default'
        },
        children: '新增按钮'
      }
    ]
  };

  // 重新渲染
  ReactDOM.render(
    renderer.renderComponent(schema),
    container
  );
}, 2000);
```
