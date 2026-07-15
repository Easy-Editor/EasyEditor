# 插件系统

插件是 EasyEditor 的**受信宿主扩展机制**。插件管理器负责依赖排序、并发结构操作、生命周期和资源回收；插件只获得完成职责所需的 `PluginContext` capability，不获得 Engine 构造权、生命周期编排权或内部 registry。

:::info 当前发布范围
当前插件系统属于框架基线。它不包含 Agent Runtime、Agent transport 或审批协议，也没有为这些实验保留稳定公开入口。`agentRestricted` 仅是信任策略预设名称。
:::

## 1. 设计目标

插件系统需要同时满足：

1. **可归属**：每个 runtime、Context、监听器和导出都属于一个 Engine 代际；
2. **可排序**：依赖缺失或成环在初始化副作用之前失败；
3. **可替换**：同名覆盖先准备候选 runtime，成功后才替换旧 runtime；
4. **可销毁**：插件 `destroy()` 与 Context disposer 都由 Engine 等待和回收；
5. **最小权限**：默认 Context 是有限 facade，而不是内核对象集合；
6. **可验证**：宿主读取冻结 snapshot，不读取管理器的可变数组和 Map。

## 2. 定义、Runtime 与 Context

```ts
interface Plugin {
  name: string
  deps?: string[]
  eventPrefix?: string
  extensionFingerprint?: string
  init(ctx: PluginContext): void | Promise<void>
  destroy?(ctx: PluginContext): void | Promise<void>
  extend?(ctx: PluginExtend): void | Promise<void>
  exports?(): Record<string, unknown>
}
```

三个对象有不同所有者：

| 对象 | 所有者 | 生命周期 |
| --- | --- | --- |
| `Plugin` 定义 | 宿主/插件包 | 可作为注册输入，但不代表已运行 |
| `PluginRuntime` | Engine 内部插件管理器 | 从 reservation 开始，初始化或回滚后结束；不公开 |
| `PluginContext` | 对应 runtime | 发布后绑定当前代；销毁后 capability 永久撤销 |

宿主通过有限 `PluginManager` 工作：

- `register(plugin, options?)`
- `registerPlugins(plugins, options?)`
- `delete(name)`
- `setDisabled(name, flag?)`
- `get(name)` / `getAll()` / `has(name)`
- `getExports(name)`

`get()` 和 `getAll()` 返回 `PluginRuntimeSnapshot`，`getExports()` 返回只读、代际绑定的 facade。它们都不会暴露原始 runtime 的 `init()`、`destroy()`、Context 或注册表。

## 3. 生命周期与提交语义

```text
初始化前注册
  -> acquire name reservation
  -> validate definition
  -> publish uninitialized runtime
  -> Engine preflight dependency graph
  -> extend (legacy only)
  -> init in dependency order

ready 后 autoInit 注册
  -> acquire name reservation
  -> preflight candidate graph
  -> init candidate runtime
  -> publish runtime
```

Engine 启动前的 `register()` 只提交待初始化 runtime；Engine 启动时先对完整依赖图做 preflight，再应用允许的原型扩展，最后按依赖顺序初始化。Engine 已 `ready` 后追加普通插件时，宿主必须显式传入 `{ autoInit: true }`，候选只有初始化成功后才会进入 registry。

同一插件的 `init()`、`destroy()` 和 `extend()` 会共享进行中的 Promise，避免重复执行。对同名插件的注册、覆盖和删除由独占 reservation 串行化。

`override: true` 分两种阶段：初始化前覆盖的是尚未运行的定义；`ready` 后与 `autoInit: true` 组合时，候选先完成依赖 preflight 和初始化，再销毁旧 runtime 并提交可见替换。

- 候选初始化失败时保留旧 runtime；
- 旧 runtime 销毁失败时不提交新 runtime；
- 候选与旧 runtime 都成功 settle 后才切换 registry 与 Context；
- 被替换 runtime 的销毁失败会作为明确错误报告，不能伪装成完全成功；
- 跨越代际才返回的异步注册或初始化结果不能提交到新一代。

插件生命周期回调不能调用同一 Engine 的 `init()` / `destroy()`；同步重入会抛出 `LifecycleReentrancyError`。在 `await` 之后使用预先捕获的 Engine 引用重入同样违反插件协议。

## 4. PluginContext capability

默认 Context 按根能力拆分：

| capability | 用途 | 有意不提供的权限 |
| --- | --- | --- |
| `project` | 读取配置、导出项目、查询数据 | Engine 生命周期、原始 Project 写入、Document/Node 反向引用 |
| `materials` | 查询/注册物料、读取受限 ComponentMeta | backing registry、回滚 token、内部 teardown |
| `setters` | 注册与读取设置器 | backing Map、直接清空 registry |
| `plugins` | 查询 snapshot 与只读导出 | 注册、覆盖或删除其他插件 |
| `event` | 带前缀的共享引擎事件 | 原始 EventBus 与 teardown |
| `pluginEvent` | 当前插件私有事件总线 | 跨插件隐式全局状态 |
| `hotkey` / `clipboard` | 编辑器交互 | 宿主 Window 所有权 |
| `config` / `logger` | 有限配置与日志 | Engine 构造和内部服务 |
| `onDispose()` | 登记清理函数 | 改变 Engine 销毁顺序 |

受限 Context 根 facade 使用有限属性集合，返回值和回调参数与当前运行代绑定。旧 Context、旧导出或旧物料引用在 Engine 重新初始化后不会复活。

插件应把自己创建的资源交回 Context：

```ts
const KeyboardPlugin = (): Plugin => ({
  name: 'KeyboardPlugin',
  init(ctx) {
    const release = ctx.hotkey.acquireBinding('ctrl+d', event => {
      event.preventDefault()
      ctx.event.emit('duplicate-requested')
    })
    ctx.onDispose(release)
  },
})
```

disposer 按逆序执行。即使插件没有实现 `destroy()`，Context disposer 仍会由 Engine 执行。

## 5. 通信与扩展缝

### 5.1 事件

插件通过 `ctx.event` 发布松耦合通知，通过 `ctx.pluginEvent` 管理插件私有事件。共享事件名会使用 `eventPrefix`；监听器必须登记 disposer。

事件只表达“已经发生”或“请求宿主处理”，不自动获得事务写权限。默认 Context 不暴露 `engine.commands` / `engine.transactions`；受限插件需要改变模型时，应发布明确请求，由宿主在 typed command/transaction 边界中决定是否执行。

### 5.2 只读导出

`exports()` 用于共享小而明确的 API。导出 facade 不应包含原始 Engine、Project、Document、Node、Context 或可变 registry，也不能被缓存到下一代。

### 5.3 物料与设置器

插件可以通过有限 capability 注册物料和设置器。注册输入中的普通数据由 registry 拥有并冻结；组件函数等不透明能力保持身份，因此仍是受信代码。

### 5.4 原型扩展

`extend()` 是迁移期兼容机制，不是推荐扩展缝。它修改同一 JavaScript Realm 的共享类原型，必须满足：

- Engine 显式选择 `legacyTrusted`；
- 插件在 Engine 初始化前注册；
- 新插件应提供稳定 `extensionFingerprint`；兼容路径允许省略，并以插件名与 `extend.toString()` 生成 fallback，但闭包身份不如显式指纹清晰；
- 多实例共享完全相同的描述符身份；
- 最后一个所有者销毁后才能恢复原始描述符。

活动原型租约与 `agentRestricted` Engine 不能共存。外部篡改描述符会导致销毁失败并进入可重试状态。新插件应优先使用事件、导出、组合和显式宿主 API。

## 6. 信任边界

`agentRestricted` 下：

- 插件 Context 是有限 capability view；
- 原型扩展被拒绝，并检查当前 Realm 的扩展完整性；
- 直接模型修改和 callback transaction 被拒绝；
- 远程访问默认拒绝。

`legacyTrusted` 下，插件可以通过 `assertLegacyTrustedPluginContext(ctx)` 显式进入兼容边界，访问旧插件所需的原始服务。该断言不会在受限策略下自动扩权。

无论选择哪种策略，插件代码都与宿主运行在同一 Realm，可以使用自己捕获的闭包、模块导入和全局对象。因此插件必须来自受信来源；若要运行不可信插件，需要独立 Worker、iframe、Realm 或进程。

## 7. 稳定、兼容与内部边界

| 层级 | 当前契约 |
| --- | --- |
| 稳定框架面 | `Plugin`、`PluginCreator`、有限 `PluginManager` / `PluginRegistry`、`PluginContext` capability、注册选项 |
| 兼容面 | `LegacyTrustedPluginContext`、`PluginExtend`、根入口插件 facade |
| 内部实现 | `PluginRuntime`、Context assembler、manager boundary、reservation、runtime registry、代际 membrane |

插件不能通过深导入 `packages/core/src/plugin/**` 获得额外稳定性。内部类即使出现在构建产物或调试栈中，也不构成语义版本承诺。

## 8. 验证方式

| 契约 | 测试族 |
| --- | --- |
| 注册、依赖与生命周期 | `plugin-lifecycle` |
| 多实例和代际撤销 | `engine-instance`、`engine-generation-boundary` |
| 有限 facade 和引用隔离 | `framework-entry`、`engine-reference-boundaries` |
| 受限写权限 | `restricted-mutation-authority` |
| 原型扩展租约、原子性与篡改 | `process-extension-atomic`、`process-trust-boundary`、`process-trust-lock`、`process-trust-registry` |
| 销毁失败与重试 | `engine-lifecycle-adversarial`、`engine-teardown-boundary` |

发布前还应运行 Core 类型测试与公共 API 基线检查，确认内部 runtime 没有意外进入 `@easy-editor/core/instance`。

## 9. 已知限制

- 插件依赖图当前用于初始化排序，不是包管理、版本解析或远程下载协议。
- 公共命令目录是封闭的；插件不能注册新的内核命令类型。
- Context capability 缩小误用面，但不能防御恶意同 Realm 代码。
- 原型扩展具有 Realm 级副作用；旧 UMD 或非托管扩展可能无法由 Engine 完整撤销。
- 同 Realm 内核无法可靠追踪生命周期回调跨 `await` 后的因果来源。
- Agent Runtime 与 Agent 插件协议均未随当前框架基线发布。

使用示例见[插件扩展](/guide/extension/plugin)，总体所有权模型见[架构综述](/design/overview)。
