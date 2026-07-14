---
title: 从 v1 迁移到 v2 引擎内核
description: 将全局单例迁移为可实例化、可销毁、可验证且具有明确信任边界的 EasyEditor 引擎
---

# 从 v1 迁移到 v2 引擎内核

EasyEditor v2 将运行时所有权从“模块导入时创建的全局单例”收束到宿主显式创建的 `EngineInstance`。每个实例拥有独立的 Project、插件、物料、设置器、事件、热键和远程资源，并由宿主负责初始化与销毁。

## 迁移目标

| v1 用法 | v2 用法 |
| --- | --- |
| 从 `@easy-editor/core` 导入 `init`、`project` 等全局对象 | 从 `@easy-editor/core/instance` 导入 `createEngine` |
| 模块加载时隐式创建共享状态 | 宿主在挂载边界显式创建实例 |
| 直接调用 `project.load()` 或修改 Node | 使用 `engine.loadProject()`、typed command 或事务边界 |
| 依赖页面刷新清理状态 | 在卸载、`pagehide` 或 HMR 中等待 `engine.destroy()` |
| 通过可变 Map 共享注册信息 | 通过只读 facade 或冻结 snapshot 读取 registry |
| 默认接受旧插件、可执行 Schema 和远程加载 | 显式选择 `agentRestricted` 或 `legacyTrusted` |

## 1. 替换根入口单例

### v1

```ts
import { init, materials, plugins, project, setters } from '@easy-editor/core'
import { componentMetas } from './materials'
import { pluginList } from './plugins'
import { setterMap } from './setters'

await plugins.registerPlugins(pluginList)
materials.buildComponentMetasMap(componentMetas)
setters.registerSetter(setterMap)
await init()
```

### v2

```ts
import { createEngine } from '@easy-editor/core/instance'
import { componentMetas } from './materials'
import { pluginList } from './plugins'
import { setterMap } from './setters'

export const engine = createEngine({
  trustPolicy: 'agentRestricted',
  hostWindow: window,
})

await engine.plugins.registerPlugins(pluginList)
engine.materials.buildComponentMetasMap(componentMetas)
engine.setters.registerSetter(setterMap)
await engine.init()

export const project = engine.project
```

不要在同一条运行链中混用根入口的 `project` 与实例的 `engine.project`。两者属于不同的状态所有权边界。

## 2. 显式管理生命周期

实例状态依次为：

```text
created -> initializing -> ready -> disposing -> disposed
                         \-> failed
```

- `init()` 和 `destroy()` 都返回 Promise。外部同类并发调用共享进行中的 Promise；`destroy()` 会等待初始化 settle 后再清理，`init()` 会等待销毁结束后再启动下一代。
- `destroy()` 清理实例拥有的插件、监听器、热键、文档、物料、设置器和远程资源。
- 销毁失败时状态进入 `failed`；再次调用 `destroy()` 会重试未完成的清理。
- 不要直接调用 `engine.materials.dispose()`、`engine.setters.dispose()` 等子服务清理方法。引擎拥有的服务必须由 `engine.destroy()` 统一销毁。
- 插件和 `RemoteAdapter` 的生命周期回调不得调用同一引擎的 `init()` / `destroy()`；直接同步重入会抛出 `LifecycleReentrancyError`。在 `await` 后通过预先捕获的原始引擎闭包调用同样违反宿主扩展协议，同 Realm 内核在没有 AsyncContext 类跟踪或隔离 Realm/进程时无法可靠识别其来源。

```ts
export function destroyEditor(): Promise<void> {
  // EngineInstance 会合并同一轮并发 destroy；不要永久缓存已完成的 Promise，
  // 否则销毁失败后的重试或重新初始化后的清理会被旧 Promise 短路。
  return engine.destroy()
}

window.addEventListener('pagehide', event => {
  if (!event.persisted) void destroyEditor()
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => destroyEditor())
}
```

如果启动失败，也要清理已创建的部分资源：

```ts
try {
  await engine.init()
} catch (startupError) {
  try {
    await engine.destroy()
  } catch (cleanupError) {
    throw new AggregateError(
      [startupError, cleanupError],
      'Editor startup and cleanup both failed',
    )
  }
  throw startupError
}
```

## 3. 选择信任策略

`createEngine()` 默认使用 `agentRestricted`。

| 能力 | `agentRestricted` | `legacyTrusted` |
| --- | --- | --- |
| 可执行 Schema / callback transaction | 拒绝 | 允许 |
| 原始 Project、Document、Node 直写 | 拒绝 | 允许 |
| 插件原型扩展 | 拒绝 | 允许 |
| 远程访问 | 拒绝 | 允许，但仍需宿主 adapter 授权 |
| 适用场景 | 新的受约束宿主 | 依赖旧插件或 UMD 的现有 Dashboard |

当前 `DashboardPlugin` 仍依赖同 Realm 原型扩展，因此迁移现有 Dashboard 时需要显式选择：

```ts
const engine = createEngine({
  trustPolicy: 'legacyTrusted',
  hostWindow: window,
})
```

`agentRestricted` 是 capability、输入校验和模型修改策略，不是恶意代码沙箱。同 Realm 插件与宿主 `RemoteAdapter` 都是受信扩展代码，仍可使用自己的闭包、导入和全局对象。`legacyTrusted` 是更宽的兼容模式；旧 UMD 或原型扩展可能留下无法通过移除 `<script>` 撤销的进程级副作用。需要隔离不可信代码时，必须使用不同 Worker、iframe、Realm 或进程。

## 4. 通过引擎拥有的写边界加载和修改模型

宿主加载 Schema 时使用 `engine.loadProject()`。它会按当前信任策略完成结构、版本、迁移和 Schema 校验，再替换项目：

```ts
import {
  type ProjectSchema,
  validateProjectSchema,
} from '@easy-editor/core/instance'

const validated = validateProjectSchema(projectSchema, engine.trustPolicy)
engine.loadProject(validated, true)
```

可审计的编辑操作使用 typed commands。一个事务要么整体提交为一个 undo 单元，要么回滚：

```ts
const document = engine.project.currentDocument
if (!document) throw new Error('当前没有活动文档')
const root = document.root
if (!root) throw new Error('当前文档没有根节点')

const result = engine.transactions.runOnDocument(document, [
  {
    type: 'updateProps',
    nodeId: root.id,
    props: { title: '已更新' },
  },
])

console.log(result.ok, result.commandCount, result.affectedNodeIds)
```

`agentRestricted` 下禁止 `runSync(() => ...)` 这类可执行 callback transaction。需要兼容 callback 的受信宿主必须显式使用 `legacyTrusted`；新代码优先使用 typed commands。

如果提交后的观察者报错，Core 会抛出 `TransactionCommittedError`，其中 `committed === true`。此时不能把操作当作“未提交”自动重试。

## 5. 用只读视图验证运行状态

v2 当前没有单一的 `getHealth()` 方法。宿主应组合以下只读信号建立健康检查：

```ts
const health = Object.freeze({
  lifecycle: engine.lifecycleState,
  materials: engine.materials.registry.getSnapshot(),
  setterCount: engine.setters.getSettersMap().size,
  remoteMaterialCount: engine.remote.registry.materialCount,
  remoteSetterCount: engine.remote.registry.setterCount,
})

if (health.lifecycle !== 'ready') {
  throw new Error(`EasyEditor engine is ${health.lifecycle}`)
}
```

- `lifecycleState` 是只读状态源。
- `materials.registry.getSnapshot()` 返回排序、分离且冻结的确定性快照，适合不变量检查和测试。
- `materials.registry.getAll()` 返回只读 Entry 视图；修改返回值不会获得 registry 写权限。
- `setters.getSettersMap()` 返回稳定的 `ReadonlyMap` facade；`set`、`delete`、`clear` 会被拒绝。
- 物料和设置器只能通过各自的注册 API 写入。

## 6. 收紧远程资源边界，暂缓 Agent

Agent Runtime、传输、授权和审批协议不属于本轮框架迁移。先完成 `@easy-editor/core/instance` 的所有权、生命周期、事务和信任边界迁移；Agent 契约将在框架稳定后单独设计。

### 远程资源

远程访问必须经过两层边界：

1. `trustPolicy` 先决定是否允许 remote capability；
2. 宿主提供的 `RemoteAdapter` 再校验资源名、类型、URL 和版本 allowlist。

不要把“资源已登记”当作“资源可信”。`engine.remote.registry` 只记录已加载资源的只读 envelope，其中 `data` 仍是 adapter 拥有的不透明能力对象。销毁实例时 adapter、加载状态和 registry 会由 `engine.destroy()` 统一清理。

`RemoteAdapter` 是受信宿主扩展；其 `init()` / `dispose()` 不得调用同一引擎的生命周期。

## 7. 默认 facade 的兼容边界

根入口仍保留 v1 facade：

```ts
import { defaultEngine, destroy, init, project } from '@easy-editor/core'
```

它是一个进程级 `legacyTrusted` 默认实例，仅用于渐进迁移：

- 不提供多实例隔离；
- 不应作为新应用的默认入口；
- 不能与显式实例的模块引用混用；
- 使用后仍必须调用并等待 `destroy()`。

完成迁移的判断标准是：业务代码只从 `@easy-editor/core/instance` 获取运行时实例，所有资源都有明确所有者和销毁点，模型写入进入 Schema、command 或事务边界，所有不可信输入都在产生副作用前完成校验。

## 下一步

- [快速开始](/guide/getting-started)
- [Core API](/reference/core/)
- [引擎所有权与信任边界](/design/overview)
