# Editor

Editor 是 EasyEditor 的核心引擎，负责管理整个编辑器的生命周期、插件系统、事件处理和核心模块的协调。它提供了一套完整的上下文管理机制，使各个模块之间能够进行有效通信和协作。

## Overview

```ts
import { createEasyEditor } from '@easyeditor/core';

// 创建编辑器实例
const editor = createEasyEditor({
  // 配置选项
  plugins: [], // 插件列表
  setters: {}, // setter 列表
  components: {}, // 组件列表
  componentMetas: {}, // 组件元数据列表
  lifeCycles: {}, // 生命周期钩子
  hotkeys: [], // 快捷键配置
  defaultSchema: {} // 默认 schema
});
```

## plugins

- 类型: `Plugin[]`

编辑器插件列表。

```ts
import ExamplePlugin from './plugins/example-plugin';
import CustomPlugin from './plugins/custom-plugin';

const editor = createEasyEditor({
  plugins: [ExamplePlugin(), CustomPlugin()]
});
```

## setters

- 类型: `Record<string, Component | Setter>`

编辑器 Setter 列表，用于属性面板。

```ts
import StringSetter from './setters/string-setter';
import SelectSetter from './setters/select-setter';

const editor = createEasyEditor({
  setters: {
    StringSetter,
    SelectSetter
  }
});
```

## components

- 类型: `Record<string, Component>`

编辑器组件列表。

```ts
import Button from './components/button';
import Input from './components/input';

const editor = createEasyEditor({
  components: {
    Button,
    Input
  }
});
```

## componentMetas

- 类型: `Record<string, ComponentMetadata>`

组件元数据列表。

```ts
const editor = createEasyEditor({
  componentMetas: {
    Button: {
      componentName: 'Button',
      title: '按钮',
      props: [
        {
          name: 'text',
          title: '文本',
          setter: 'StringSetter'
        }
      ]
    }
  }
});
```

## lifeCycles

- 类型: `LifeCyclesConfig`

编辑器生命周期钩子。

```ts
const editor = createEasyEditor({
  lifeCycles: {
    init: (editor) => {
      console.log('编辑器初始化');
    },
    destroy: (editor) => {
      console.log('编辑器销毁');
    },
    extend: (editor) => {
      console.log('编辑器扩展');
    }
  }
});
```

## designer

- 类型: `Pick<DesignerProps, 'onDragstart' | 'onDrag' | 'onDragend'>`

Designer 的配置选项。

```ts
const editor = createEasyEditor({
  designer: {
    onDragstart: (e) => {
      console.log('拖拽开始', e);
    },
    onDrag: (e) => {
      console.log('拖拽中', e);
    },
    onDragend: (e) => {
      console.log('拖拽结束', e);
    }
  }
});
```

## hotkeys

- 类型: `HotkeyConfig[]`

编辑器快捷键配置。

```ts
const editor = createEasyEditor({
  hotkeys: [
    {
      key: 'ctrl+s',
      callback: (e) => {
        e.preventDefault();
        console.log('保存操作');
      }
    },
    {
      key: 'ctrl+z',
      callback: (e) => {
        e.preventDefault();
        console.log('撤销操作');
      }
    }
  ]
});
```

## defaultSchema

- 类型: `ProjectSchema`
- 默认值: `{
    version: '0.0.1',
    componentsTree: [],
  }`

编辑器默认 schema。

```ts
const editor = createEasyEditor({
  defaultSchema: {
    componentName: "Page",
    props: {
      title: "新页面"
    },
    children: []
  }
});
```

## get

- 类型: `get<T = undefined, KeyOrType extends EditorValueKey = any>(keyOrType: KeyOrType): EditorGetResult<T, KeyOrType> | undefined`
- 参数:
  - `keyOrType`: 要获取的值的 key 或类型

从编辑器上下文中获取指定 key 的值

```ts
// 获取设计器实例
const designer = editor.get('designer');

// 使用类型获取
const project = editor.get<Project>('project');
```

## set

- 类型: `set(key: EditorValueKey, data: any): void | Promise`
- 参数:
  - `key`: 要设置的值的 key
  - `data`: 要设置的值

设置编辑器上下文中指定 key 的值

```ts
// 设置自定义数据
editor.set('customData', { value: 'test' });
```

## has

- 类型: `has(keyOrType: EditorValueKey): boolean`
- 参数:
  - `keyOrType`: 要检查的值的 key 或类型

检查编辑器上下文中是否存在指定 key 的值

```ts
// 检查是否存在设计器实例
if (editor.has('designer')) {
  console.log('设计器已初始化');
}
```

## onceGot

- 类型: `onceGot<T = undefined, KeyOrType extends EditorValueKey = any>(keyOrType: KeyOrType): Promise<EditorGetResult<T, KeyOrType>>`
- 参数:
  - `keyOrType`: 要获取的值的 key 或类型

获取指定 key 的值，如果当前不存在则等待直到该值被设置

```ts
// 等待设计器实例
const designer = await editor.onceGot('designer');

// 等待项目实例，并指定类型
const project = await editor.onceGot<Project>('project');
```

## onGot

- 类型: `onGot<T = undefined, KeyOrType extends EditorValueKey = any>(keyOrType: KeyOrType, fn: (data: EditorGetResult<T, KeyOrType>) => void): () => void`
- 参数:
  - `keyOrType`: 要监听的值的 key 或类型
  - `fn`: 当值存在或被设置时调用的回调函数

监听指定 key 的值，当值存在或被设置时调用回调函数

```ts
// 监听设计器实例
const dispose = editor.onGot('designer', (designer) => {
  console.log('设计器已就绪:', designer);
});

// 取消监听
dispose();
```

## onChange

- 类型: `onChange<T = undefined, KeyOrType extends EditorValueKey = any>(keyOrType: KeyOrType, fn: (data: EditorGetResult<T, KeyOrType>) => void): () => void`
- 参数:
  - `keyOrType`: 要监听的值的 key 或类型
  - `fn`: 当值变化时调用的回调函数

监听指定 key 的值变化，当值变化时调用回调函数

```ts
// 监听设计器实例变化
const dispose = editor.onChange('designer', (designer) => {
  console.log('设计器已更新:', designer);
});

// 取消监听
dispose();
```

## init

- 类型: `init(config?: EditorConfig): Promise`
- 参数:
  - `config`: 可选，编辑器配置

初始化编辑器

```ts
// 初始化编辑器
await editor.init({
  plugins: [MyPlugin()],
  components: myComponents
});
```

## destroy

- 类型: `destroy(): void`

销毁编辑器，清理资源

```ts
// 销毁编辑器
editor.destroy();
```

## extend

- 类型: `extend(pluginManager: PluginManager): Promise`
- 参数:
  - `pluginManager`: 插件管理器实例

扩展编辑器，执行插件的 extend 方法

```ts
// 通常在内部使用，不需要手动调用
const pluginManager = editor.get('pluginManager');
await editor.extend(pluginManager);
```

## onBeforeInit

- 类型: `onBeforeInit(listener: (editor: Editor) => void): () => void`
- 参数:
  - `listener`: 事件监听器

监听编辑器初始化前事件

```ts
// 监听编辑器初始化前事件
const dispose = editor.onBeforeInit((editor) => {
  console.log('编辑器即将初始化');
});

// 取消监听
dispose();
```

## onAfterInit

- 类型: `onAfterInit(listener: (editor: Editor) => void): () => void`
- 参数:
  - `listener`: 事件监听器

监听编辑器初始化后事件

```ts
// 监听编辑器初始化后事件
const dispose = editor.onAfterInit((editor) => {
  console.log('编辑器已初始化完成');
});

// 取消监听
dispose();
```

## onDestroy

- 类型: `onDestroy(listener: (editor: Editor) => void): () => void`
- 参数:
  - `listener`: 事件监听器

监听编辑器销毁事件

```ts
// 监听编辑器销毁事件
const dispose = editor.onDestroy((editor) => {
  console.log('编辑器已销毁');
});

// 取消监听
dispose();
```

## onBeforeExtend

- 类型: `onBeforeExtend(listener: (editor: Editor) => void): () => void`
- 参数:
  - `listener`: 事件监听器

监听编辑器扩展前事件

```ts
// 监听编辑器扩展前事件
const dispose = editor.onBeforeExtend((editor) => {
  console.log('编辑器即将扩展');
});

// 取消监听
dispose();
```

## onAfterExtend

- 类型: `onAfterExtend(listener: (editor: Editor) => void): () => void`
- 参数:
  - `listener`: 事件监听器

监听编辑器扩展后事件

```ts
// 监听编辑器扩展后事件
const dispose = editor.onAfterExtend((editor) => {
  console.log('编辑器已扩展完成');
});

// 取消监听
dispose();
```
