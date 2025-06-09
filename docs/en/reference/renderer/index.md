# Renderer

::: warning English Documentation Status
This English documentation is currently under development. The content may be incomplete or subject to change. For the most complete and up-to-date information, please refer to the Chinese documentation. We appreciate your patience as we work to provide comprehensive English documentation.
:::

The renderer is the core module of EasyEditor that renders component trees (schema) into actual UI interfaces. It provides functionality to convert component metadata and properties into actual DOM elements, serving as a bridge connecting the editor design system with the final rendering result.

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

- Type: `Record<string, React.ComponentType<any>>`

Component mapping table registered to the renderer

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

- Type: `'live' | 'design'`
- Default: `'design'`

Working mode of the renderer, `'live'` for runtime mode, `'design'` for design mode

```tsx
function App() {
  return (
    <Renderer
      schema={schema}
      components={components}
      designMode="live" // Runtime mode
    />
  );
}
```

## className

- Type: `string`

CSS class name for the renderer root node

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

- Type: `React.CSSProperties`

Style for the renderer root node

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

- Type: `RendererAppHelper`

Global context of the renderer, accessible in components via `this`

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

- Type: `'default' | 'pc' | 'mobile' | string`
- Default: `'default'`

Device type of the renderer for responsive rendering

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

- Type: `React.ComponentType<NotFoundComponentProps>`

Component to display when a component is not found

```tsx
const CustomNotFoundComponent = ({ componentName }) => {
  return <div className="custom-not-found">Component {componentName} not found</div>;
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

- Type: `React.ComponentType<FaultComponentProps>`

Component to display when component rendering fails

```tsx
const CustomFaultComponent = ({ componentName, error }) => {
  return (
    <div className="custom-fault">
      <h3>Component {componentName} rendering error</h3>
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

- Type: `string`

ID of the current document, used in multi-document mode

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

- Type: `boolean`
- Default: `false`

Whether the rendering module is suspended. When set to true, shouldComponentUpdate of the outermost container will always return false

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

- Type: `(schema: NodeSchema, ref: any) => void`

Hook triggered when a component gets a ref

```tsx
function App() {
  const handleCompGetRef = (schema, ref) => {
    console.log(`Component ${schema.id} ref:`, ref);
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

- Type: `() => boolean`

Get flag indicating whether schema has changed

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

- Type: `(symbol: boolean) => void`

Set flag indicating whether schema has changed

```tsx
// See example above
```

## getNode

- Type: `(id: string) => Node`

Method to get a node

```tsx
function App() {
  // Assuming document is the current document instance
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

- Type: `boolean`

When component not found strict mode is enabled, the renderer will not provide a default container component

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

- Type: `boolean`

Whether to execute lifecycle methods in design mode

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

## Parsing JSExpression

The renderer supports using expressions in schema properties:

```tsx
const schema = {
  componentName: 'Button',
  props: {
    disabled: {
      type: 'JSExpression',
      value: 'this.data.loading'
    }
  },
  children: 'Submit'
};

function App() {
  return <Renderer schema={schema} components={components} />;
}
```

The `this` in expressions points to the renderer context, containing the following properties:

- `this.utils`: Utility methods
- `this.constants`: Constants
- `this.data`: Component data
- `this.state`: Component state
- `this.appHelper`: Corresponds to `appHelper` set on `Renderer`

## Event Handling JSFunction

The renderer supports defining event handlers in schema:

```tsx
const schema = {
  componentName: 'Form',
  props: {
    onSubmit: {
      type: 'JSFunction',
      value: `function(values) {
        console.log('Form submitted:', values);
        this.utils.request('/api/submit', {
          method: 'POST',
          data: values
        });
      }`
    }
  },
  children: [
    // Form items
  ]
};

function App() {
  return <Renderer schema={schema} components={components} />;
}
```

Event handlers can access the renderer context as well as parameters passed by components.
