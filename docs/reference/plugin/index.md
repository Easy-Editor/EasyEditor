# Plugin

Plugin 是 EasyEditor 的核心扩展机制，用于扩展编辑器功能和行为。

## Overview

```ts
interface Plugin {
  name: string;
  deps?: string[];
  eventPrefix?: string;
  init(ctx: PluginContext): void | void;
  extend?(ctx: PluginExtend): void;
  destroy?(ctx: PluginContext): void | void;
}
```

## name

- 类型: `string`
- 描述: 插件的唯一名称标识符

```ts
const MyPlugin: PluginCreator<Options> = () => {
  return {
    name: 'MyPlugin'
    // ...
  };
};
```

## deps

- 类型: `string[]`
- 默认值: `[]`
- 描述: 插件依赖的其他插件名称

```ts
const MyPlugin: PluginCreator<Options> = () => {
  return {
    name: 'MyPlugin',
    deps: ['OtherPlugin'] // 声明依赖，会先加载 OtherPlugin
    // ...
  };
};
```

## eventPrefix

- 类型: `string`
- 默认值: `plugin的name`
- 描述: 插件事件前缀，用于插件事件命名空间

```ts
const MyPlugin: PluginCreator<Options> = () => {
  return {
    name: 'MyPlugin',
    eventPrefix: 'myPrefix'
    // ...
  };
};
```

## init

- 签名: `init(ctx: PluginContext): void | void`
- 描述: 插件初始化方法，在编辑器加载插件时调用
- 参数:
  - `ctx`: 插件上下文，提供访问编辑器核心模块的能力
- 返回值: void 或 Promise

```ts
const MyPlugin: PluginCreator<Options> = () => {
  return {
    name: 'MyPlugin',
    init(ctx) {
      const { designer, logger, hotkey } = ctx;

      // 注册快捷键
      hotkey.bind('ctrl+d', e => {
        e.preventDefault();
        logger.log('快捷键触发');
      });

      // 监听设计器事件
      designer.on('selection.change', selectedIds => {
        logger.log('选择已变更:', selectedIds);
      });
    }
  };
};
```

## extend

- 签名: `extend(ctx: PluginExtend): void`
- 描述: 扩展核心类的方法，允许插件扩展编辑器核心模块的功能
- 参数:
  - `ctx`: 插件扩展上下文，提供扩展核心类的能力
- 返回值: void

```ts
const MyPlugin: PluginCreator<Options> = () => {
  return {
    name: 'MyPlugin',
    extend({ extend }) {
      // 扩展 Designer 类
      extend('Designer', {
        // 添加新方法
        selectParent: {
          value() {
            const selected = this.getSelected();
            if (selected.length > 0) {
              const node = this.project.getCurrentDocument().getNode(selected[0]);
              const parent = node?.getParent();
              if (parent && parent.getId() !== 'root') {
                this.select(parent.getId());
              }
            }
          }
        }
      });
    }
  };
};
```

## destroy

- 签名: `destroy(ctx: PluginContext): void | void`
- 描述: 插件销毁方法，在编辑器卸载插件时调用，用于清理资源
- 参数:
  - `ctx`: 插件上下文
- 返回值: void 或 Promise

```ts
const MyPlugin: PluginCreator<Options> = () => {
  const disposers = [];

  return {
    name: 'MyPlugin',
    init(ctx) {
      const { designer } = ctx;

      // 存储需要清理的监听器
      disposers.push(
        designer.on('selection.change', () => {})
      );
    },
    destroy(ctx) {
      // 清理资源
      disposers.forEach(dispose => dispose());

      ctx.logger.log('插件已销毁');
    }
  };
};
```

## PluginContext

插件上下文提供对编辑器核心模块的访问：

```ts
interface PluginContext {
  editor: Editor;
  designer: Designer;
  project: Project;
  simulator: Simulator;
  setterManager: SetterManager;
  componentMetaManager: ComponentMetaManager;
  event: EventBus;
  pluginEvent: EventBus;
  hotkey: Hotkey;
  logger: Logger;
}
```

## PluginExtend

插件扩展接口，用于扩展核心类的功能：

```ts
interface PluginExtend {
  extendClass: PluginExtendClass;
  extend: <T extends keyof PluginExtendClass>(
    extendClass: T,
    properties: Record<PropertyKey, () => any> | (PropertyDescriptorMap & ThisType<InstanceType<PluginExtendClass[T]>>)
  ) => void;
}
```

## PluginExtendClass

可扩展的核心类列表：

```ts
interface PluginExtendClass {
  Simulator: typeof Simulator;
  Viewport: typeof Viewport;
  Designer: typeof Designer;
  Dragon: typeof Dragon;
  Detecting: typeof Detecting;
  Selection: typeof Selection;
  DropLocation: typeof DropLocation;
  OffsetObserver: typeof OffsetObserver;
  Project: typeof Project;
  Document: typeof Document;
  History: typeof History;
  Node: typeof Node;
  NodeChildren: typeof NodeChildren;
  Props: typeof Props;
  Prop: typeof Prop;
  ComponentMetaManager: typeof ComponentMetaManager;
  SetterManager: typeof SetterManager;
  ComponentMeta: typeof ComponentMeta;
}
```

## PluginCreator

- 类型: `<O = any>(options?: O) => Plugin`
- 描述: 创建插件的函数类型

```ts
import type { PluginCreator } from '@easy-editor/core';

interface MyPluginOptions {
  option1?: string;
}

const MyPlugin: PluginCreator<MyPluginOptions> = (options = {}) => {
  return {
    name: 'MyPlugin',
    init(ctx) {
      console.log(options.option1);
    }
  };
};

export default MyPlugin;
```
