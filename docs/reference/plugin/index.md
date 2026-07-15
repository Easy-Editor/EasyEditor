# Plugin

Plugin 是 EasyEditor 的核心扩展机制，用于扩展编辑器功能和行为。

## Overview

```ts
interface Plugin {
  name: string;
  deps?: string[];
  eventPrefix?: string;
  extensionFingerprint?: string;
  init(ctx: PluginContext): Promise<void> | void;
  extend?(ctx: PluginExtend): Promise<void> | void;
  destroy?(ctx: PluginContext): Promise<void> | void;
  exports?(): Record<string, unknown>;
}
```

## name

- 类型: `string`

插件的唯一名称标识符

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

插件依赖的其他插件名称

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
- 默认值: `common`

插件事件前缀，用于插件事件命名空间

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

- 类型: `init(ctx: PluginContext): Promise<void> | void`
- 参数:
  - `ctx`: 插件上下文，提供访问编辑器核心模块的能力

插件初始化方法，在编辑器加载插件时调用。返回 Promise 时，引擎会等待它 settle 后再完成初始化。

```ts
const MyPlugin: PluginCreator<Options> = () => {
  return {
    name: 'MyPlugin',
    init(ctx) {
      const { logger, hotkey } = ctx;

      // 注册快捷键
      const handleDuplicate = (e: KeyboardEvent) => {
        e.preventDefault();
        logger.log('快捷键触发');
      };
      ctx.onDispose(hotkey.acquireBinding('ctrl+d', handleDuplicate));
    }
  };
};
```

## extend

- 类型: `extend(ctx: PluginExtend): Promise<void> | void`
- 参数:
  - `ctx`: 插件扩展上下文，提供扩展核心类的能力

扩展核心类的方法，允许兼容插件扩展编辑器核心模块的功能。返回 Promise 时，引擎会等待扩展完成。原型扩展只适用于初始化前注册的 `legacyTrusted` 兼容插件；`agentRestricted` 会拒绝它。引擎按 manager 所有权租赁，并且只引用计数 fingerprint 与运行时函数/getter/setter 引用都相同的描述符；函数源码相同不会被视为闭包身份相同。扩展批次原子提交，最后一个所有者销毁后恢复原始原型；活动租约不能与同 Realm 的受限引擎并存。

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

- 类型: `destroy(ctx: PluginContext): Promise<void> | void`
- 参数:
  - `ctx`: 插件上下文

插件销毁方法，在编辑器卸载插件时调用，用于清理资源。返回 Promise 时，引擎会等待清理完成；失败会进入可重试的引擎清理流程。

```ts
const MyPlugin: PluginCreator<Options> = () => {
  return {
    name: 'MyPlugin',
    init(ctx) {
      const dispose = ctx.event.on('common:selection-change', selectedIds => {
        ctx.logger.log('选择已变更:', selectedIds);
      });
      ctx.onDispose(dispose);
    },
    async destroy(ctx) {
      ctx.logger.log('插件已销毁');
    }
  };
};
```

## PluginContext

插件上下文提供一组由引擎拥有、与当前运行代绑定的能力：

```ts
interface PluginContext {
  project: PluginProjectCapability;
  plugins: PluginRegistry;
  setters: PluginSettersCapability;
  materials: PluginMaterialsCapability;
  event: PluginEventCapability;
  pluginEvent: EventBus;
  hotkey: PluginHotkeyCapability;
  clipboard?: PluginClipboardCapability;
  config: PluginConfigCapability;
  logger: PluginLoggerCapability;
  trustPolicy?: TrustPolicy;
  onDispose(disposer: Disposable): Disposable;
}
```

在默认 `agentRestricted` 策略下，这些根能力是有限 facade，而不是原始服务对象：

- 不提供 `engine.init()` / `engine.destroy()`，也不暴露已知的反向权限字段；
- `plugins` 只是只读 `PluginRegistry`，不能注册或删除其他插件；
- `event` 是经过前缀约束的共享引擎事件能力，`pluginEvent` 是插件私有事件总线，不暴露共享引擎的原始 event bus；
- Context 与回调参数绑定当前运行代，销毁后保留引用会失效；
- facade 用来收窄受支持 API、输入和模型修改权限，不是恶意代码沙箱。

插件与 `RemoteAdapter` 都运行在宿主 JavaScript Realm 中，因此必须被视为受信扩展代码。插件生命周期回调不得调用同一引擎的 `init()` / `destroy()`；直接同步重入会抛出 `LifecycleReentrancyError`。如果插件预先捕获原始引擎并在 `await` 后调用生命周期，没有 AsyncContext 类因果跟踪或 Realm/进程隔离的同 Realm 内核无法可靠识别来源；这种行为属于宿主扩展协议违规。

仍需原始 `Project`、`Designer`、`Simulator` 等宿主服务的兼容插件，必须在 `init()` 中调用 `assertLegacyTrustedPluginContext(ctx)`，且宿主使用 `legacyTrusted`。该断言只会验证显式策略，不会在 `agentRestricted` 下扩权；新插件不应依赖此接口。

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
  Materials: typeof Materials;
  Setters: typeof Setters;
  ComponentMeta: typeof ComponentMeta;
}
```

## PluginCreator

- 类型: `<O = any>(options?: O) => Plugin`

创建插件的函数类型

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
