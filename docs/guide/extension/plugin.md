# 插件扩展

插件是 EasyEditor 的宿主扩展机制。稳定宿主从 `@easy-editor/core/instance` 创建引擎，通过有限 `PluginManager` 注册插件；插件定义不会获得 `PluginRuntime`、引擎生命周期编排或管理器内部 registry。

## 生命周期

一个插件按以下顺序参与引擎生命周期：

1. **注册**：校验唯一名称、依赖和注册选项。
2. **扩展**：若定义 `extend`，在初始化前应用兼容性原型扩展。
3. **初始化**：调用 `init(ctx)`；返回 Promise 时引擎会等待。
4. **运行**：插件通过当前运行代的 Context 能力工作。
5. **销毁**：调用 `destroy(ctx)` 并等待结果，再执行 Context disposer。

```ts
interface Plugin {
  name: string
  deps?: string[]
  eventPrefix?: string
  extensionFingerprint?: string
  init(ctx: PluginContext): Promise<void> | void
  extend?(ctx: PluginExtend): Promise<void> | void
  destroy?(ctx: PluginContext): Promise<void> | void
  exports?(): Record<string, unknown>
}
```

插件生命周期回调不得调用同一引擎的 `init()` 或 `destroy()`；直接同步重入会抛出 `LifecycleReentrancyError`。受限 PluginContext 不暴露这两个方法。

插件也不得捕获原始引擎引用并在生命周期回调 `await` 之后调用其生命周期。同 Realm JavaScript 在没有 AsyncContext 类因果跟踪或 Realm/进程隔离时无法可靠区分这种调用与外部宿主调用；这是扩展协议约束，不是沙箱保证。

## 基础插件

```ts
import type { PluginCreator } from '@easy-editor/core/instance'

interface Options {
  debug?: boolean
}

const MyPlugin: PluginCreator<Options> = (options = {}) => ({
  name: 'MyPlugin',
  eventPrefix: 'my-plugin',

  init(ctx) {
    if (options.debug) ctx.logger.info('MyPlugin initialized')

    const disposeEvent = ctx.event.on('common:document-open', documentId => {
      ctx.logger.info('Document opened:', documentId)
    })
    ctx.onDispose(disposeEvent)

    const handleDuplicate = (event: KeyboardEvent) => {
      event.preventDefault()
      ctx.event.emit('shortcut', { command: 'duplicate' })
    }
    ctx.hotkey.bind('ctrl+d', handleDuplicate)
    ctx.onDispose(() => ctx.hotkey.unbind('ctrl+d', handleDuplicate))
  },

  async destroy(ctx) {
    ctx.logger.info('MyPlugin destroyed')
  },
})

export default MyPlugin
```

优先用 `ctx.onDispose()` 登记监听器、快捷键、计时器和其他资源的清理函数。即使插件没有实现 `destroy`，Context disposer 仍由引擎统一拥有。

## 注册插件

```ts
import { createEngine } from '@easy-editor/core/instance'
import MyPlugin from './my-plugin'

const engine = createEngine({
  trustPolicy: 'agentRestricted',
  hostWindow: window,
})

await engine.plugins.register(MyPlugin({ debug: true }))
await engine.init({ designMode: 'design' })

// 引擎已就绪后注册的普通插件需要显式 autoInit。
await engine.plugins.register(AnotherPlugin(), { autoInit: true })
```

注册与删除都是异步操作，必须等待：

- `register(plugin, { autoInit?, override? })`
- `registerPlugins(plugins, options?)`
- `delete(name)`

`get()` / `getAll()` 只返回冻结的 `PluginRuntimeSnapshot`；`getExports()` 返回与当前运行代绑定的只读导出 facade。宿主和插件都拿不到原始 `PluginRuntime` 或其生命周期方法。

## 插件通信

### 事件

`ctx.event.emit(name, payload)` 会按当前插件的 `eventPrefix` 补全事件名。监听跨插件事件时使用完整名称：

```ts
const Producer = (): Plugin => ({
  name: 'Producer',
  eventPrefix: 'producer',
  init(ctx) {
    ctx.event.emit('ready', { version: 1 })
  },
})

const Consumer = (): Plugin => ({
  name: 'Consumer',
  init(ctx) {
    ctx.onDispose(
      ctx.event.on('producer:ready', payload => {
        ctx.logger.info('Producer ready:', payload.version)
      }),
    )
  },
})
```

在受限策略下，回调参数也经过当前运行代的 capability membrane；不要把它们当作可跨代保存的原始内核对象。

### 只读导出

需要共享明确 API 时，使用插件导出，不要向 Context 动态挂载全局变量：

```ts
interface CounterApi {
  read(): number
}

const Counter = (): Plugin => {
  let value = 0
  return {
    name: 'Counter',
    init() {
      value += 1
    },
    exports: () => ({ read: () => value }),
  }
}

const Reader = (): Plugin => ({
  name: 'Reader',
  deps: ['Counter'],
  init(ctx) {
    const counter = ctx.plugins.getExports<CounterApi>('Counter')
    ctx.logger.info('Counter:', counter?.read())
  },
})
```

导出引用在所属运行代销毁后会失效；不要缓存到下一次 `init()`。

## PluginContext 边界

Context 提供以下类别的能力：

- `project`：项目读取与受策略约束的有限项目操作；
- `materials` / `setters`：经审查的注册与读取 API；
- `plugins`：只读 `PluginRegistry`；
- `event`：经过前缀约束的共享引擎事件能力；`pluginEvent`：当前插件私有的事件总线；
- `hotkey` / `clipboard`：交互能力；
- `config` / `logger` / `trustPolicy`：配置、日志和策略信息；
- `onDispose(disposer)`：把资源清理交回引擎所有。

默认 `agentRestricted` Context 使用有限、null-prototype 的根 facade，并通过代际 membrane 包装返回值和回调参数。它省略引擎生命周期、内部 registry、共享引擎的原始 event bus、teardown 方法以及已知反向权限字段；`pluginEvent` 只属于当前插件。`plugins` 不能注册、覆盖或删除其他插件。

这是一条 **API、输入和模型修改权限边界**，不是恶意代码沙箱。插件和宿主提供的 `RemoteAdapter` 都在同一个 JavaScript Realm 中执行，必须视为受信扩展代码；它们仍可使用自己的闭包、导入和全局对象。需要运行不可信代码时，使用 Worker、iframe、隔离 Realm 或独立进程。

Context 和其派生 capability 与运行代绑定。实例销毁后，保留的 Context、回调值、物料 meta 或插件导出不会在下一代复活。

旧插件如果必须访问 `Project.designer`、`Project.simulator` 等原始宿主服务，必须显式声明兼容边界，并且宿主必须选择 `legacyTrusted`：

```ts
import {
  assertLegacyTrustedPluginContext,
  type PluginCreator,
} from '@easy-editor/core/instance'

const LegacyPlugin: PluginCreator = () => ({
  name: 'LegacyPlugin',
  init(ctx) {
    assertLegacyTrustedPluginContext(ctx)
    ctx.project.designer.onEvent('legacy-event', () => {})
  },
})
```

断言在 `agentRestricted` 下会立即失败，不会把有限 Context 扩权。它只用于标记仍依赖直接宿主权限的迁移期插件；新插件应继续面向有限 capability 编写。

## 原型扩展兼容模式

包含 `extend` 的插件会修改共享 Realm 中的类原型，只能：

1. 在引擎初始化前注册；
2. 使用显式 `legacyTrusted`；
3. 提供稳定 `extensionFingerprint` 以标识进程级扩展；
4. 接受脚本移除和实例销毁无法撤销进程级原型副作用。

```ts
import { createEngine, type Node, type Plugin } from '@easy-editor/core/instance'

const ExtendPlugin = (): Plugin => ({
  name: 'ExtendPlugin',
  extensionFingerprint: 'extend-plugin@1',
  init() {},
  extend({ extend }) {
    extend('Node', {
      getPluginLabel: {
        value(this: Node) {
          return `${this.componentName}:${this.id}`
        },
      },
    })
  },
})

const engine = createEngine({ trustPolicy: 'legacyTrusted' })
await engine.plugins.register(ExtendPlugin())
await engine.init()
```

原型扩展插件不能在引擎就绪后通过 `autoInit` 追加。`legacyTrusted` 也是受信兼容模式，不是沙箱；新插件应优先使用组合、事件、导出和显式宿主 API，而不是修改原型。

可扩展类当前包括 Simulator、Viewport、Designer、Dragon、Detecting、Selection、DropLocation、OffsetObserver、Project、Document、History、Node、NodeChildren、Props、Prop、Materials、Setters 和 ComponentMeta。

## 注册选项

- `autoInit: true`：仅用于引擎已就绪后注册的普通插件。
- `override: true`：候选插件先成功初始化，再原子替换同名 runtime；失败时保留旧插件。

同名注册、覆盖和删除由管理器 reservation 串行化。不要绕过 `engine.plugins` 操作内部 registry。

完整类型见 [Plugin API](/reference/plugin/)；框架所有权与信任模型见[架构综述](/design/overview)。
