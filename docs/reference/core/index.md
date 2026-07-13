# Core API

EasyEditor v2 的稳定运行时边界是宿主拥有的 `EngineInstance`。实例把生命周期、插件、物料、设置器、项目替换、命令事务、Agent capability 和远程资源收束到同一个所有权边界中。

::: warning v2 写入边界
`engine.project`、`engine.designer` 以及公开的 Document/Node 类型仍用于渲染集成和旧代码兼容，但原始模型修改方法不是稳定的 v2 业务写入边界。新代码应使用 `engine.loadProject()`、`engine.unloadProject()`、`engine.commands`、`engine.transactions`、`engine.undo()` 和 `engine.redo()`。
:::

## 创建实例

```ts
import {
  type EngineInstance,
  createEngine,
} from '@easy-editor/core/instance'

export const engine: EngineInstance = createEngine({
  trustPolicy: 'agentRestricted',
  hostWindow: window,
})
```

`createEngine()` 每次都返回一个独立实例；不要把不同实例的 Project、Document、Node、插件上下文或 registry 值交叉使用。

### EngineInstanceOptions

| 选项 | 含义 |
| --- | --- |
| `trustPolicy` | 信任策略或自定义策略。默认是 `agentRestricted` |
| `hostWindow` | 热键等浏览器能力所属的 Window；传 `null` 可显式禁用全局 Window 解析 |
| `remoteAdapter` | 宿主拥有的远程资源 adapter；是否允许访问仍由信任策略决定 |

## 生命周期

### `engine.init(options?)`

**类型：** `(options?: ConfigOptions) => Promise<void>`

```ts
import type { EngineInstance } from '@easy-editor/core/instance'

export async function startEngine(engine: EngineInstance): Promise<void> {
  await engine.init({
    designMode: 'design',
    locale: 'zh-CN',
  })
}
```

`ConfigOptions.designMode` 只接受 `'design' | 'live'`。初始化成功后 `lifecycleState` 为 `ready`。并发 `init()` 会等待同一轮初始化；对已经就绪的实例再次调用 `init()` 会先销毁当前运行代，再重新初始化。

### `engine.destroy()`

**类型：** `() => Promise<void>`

```ts
import type { EngineInstance } from '@easy-editor/core/instance'

export function destroyEngine(engine: EngineInstance): Promise<void> {
  return engine.destroy()
}
```

`destroy()` 会阻止新写入，并清理实例拥有的 Agent capability、插件、监听器、Designer、Project、热键、物料、设置器、远程 adapter/registry 和事件。并发销毁会合并到同一轮操作；清理失败时状态进入 `failed`，再次调用会重试。

不要永久缓存已经 settle 的销毁 Promise，也不要单独销毁 `materials`、`setters`、`project` 等引擎拥有的子服务。

### `engine.lifecycleState`

```ts
type EngineLifecycleState =
  | 'created'
  | 'initializing'
  | 'ready'
  | 'disposing'
  | 'disposed'
  | 'failed'
```

这是只读状态源。宿主可以据此拒绝未就绪请求，但不能通过赋值改变生命周期。

## 实例模块

| 模块 | 责任 |
| --- | --- |
| `plugins` | 异步注册、排序、初始化和销毁插件 |
| `materials` | 注册组件元数据，并提供可验证 registry 快照 |
| `setters` | 注册设置器，并提供稳定的只读 Map facade |
| `project` / `designer` | 渲染器集成与旧模型读取；不是新的稳定直写边界 |
| `commands` / `transactions` | 可验证、可回滚、可审计的模型写入 |
| `agentCapabilities` | 最小权限 Agent capability、preview、执行与审计 |
| `remote` | 经信任策略和宿主 adapter 双重授权的远程资源访问 |
| `config` / `event` / `eventBus` / `hotkey` | 实例拥有的配置与交互基础设施 |

## 注册插件、物料和设置器

插件注册是异步操作，必须等待：

```ts
import type { EngineInstance, Plugin } from '@easy-editor/core/instance'

export async function installPlugins(
  engine: EngineInstance,
  pluginList: Plugin[],
): Promise<void> {
  await engine.plugins.registerPlugins(pluginList)
}
```

物料和设置器通过实例注册 API 写入：

```ts
import type {
  ComponentMetadata,
  EngineInstance,
  Setter,
} from '@easy-editor/core/instance'

export function registerMetadata(
  engine: EngineInstance,
  componentMetas: ComponentMetadata[],
  setterMap: Record<string, Setter>,
): void {
  engine.materials.buildComponentMetasMap(componentMetas)
  engine.setters.registerSetter(setterMap)
}
```

- `engine.materials.registry.getSnapshot()` 返回排序、分离且冻结的确定性数据。
- `engine.materials.registry.getAll()` 返回只读 Entry 视图，不暴露 backing Map。
- `engine.setters.getSettersMap()` 返回稳定的 `ReadonlyMap` facade；`set`、`delete`、`clear` 会被拒绝。

## 验证并替换项目

宿主输入先按实例策略校验，再通过引擎拥有的边界替换 Project：

```ts
import {
  type EngineInstance,
  type ProjectSchema,
  validateProjectSchema,
} from '@easy-editor/core/instance'

export function replaceProject(
  engine: EngineInstance,
  schema: ProjectSchema,
): void {
  const validated = validateProjectSchema(schema, engine.trustPolicy)
  engine.loadProject(validated, true)
}

export function clearProject(engine: EngineInstance): void {
  engine.unloadProject()
}
```

校验覆盖结构、当前版本、迁移结果、信任策略和 Schema 不变量。不要把 `validateProjectSchema()` 的成功当作可执行代码安全证明；受限策略仍会拒绝可执行 Schema。

## 命令、事务与历史

```ts
import type { EngineInstance } from '@easy-editor/core/instance'

export function updateRootTitle(
  engine: EngineInstance,
  title: string,
) {
  const document = engine.project.currentDocument
  if (!document) throw new Error('当前没有活动文档')
  const root = document.root
  if (!root) throw new Error('当前文档没有根节点')

  return engine.transactions.runOnDocument(document, [
    {
      type: 'updateProps',
      nodeId: root.id,
      props: { title },
    },
  ])
}
```

- `engine.commands.execute(command)` 执行一个 typed command。
- `engine.transactions.run(commands)` 在当前文档上执行一个批次。
- `engine.transactions.runOnDocument(documentOrId, commands, options?)` 绑定一个属于该实例的文档。
- 成功批次形成一个 undo 单元；失败会回滚模型、历史、选区、物料计数和延迟事件。
- `engine.undo(documentOrId?)` / `engine.redo(documentOrId?)` 通过引擎边界修改历史。
- `agentRestricted` 拒绝 callback transaction 和公开的可执行前后置条件。
- `TransactionCommittedError.committed === true` 表示模型已经提交、但提交后观察者失败；不能当作未提交操作自动重试。

## 只读验证信号

Core 当前没有单一 `getHealth()`。宿主应组合只读信号建立健康检查：

```ts
import type { EngineInstance } from '@easy-editor/core/instance'

export function getEngineHealth(engine: EngineInstance) {
  return Object.freeze({
    lifecycle: engine.lifecycleState,
    materials: engine.materials.registry.getSnapshot(),
    setterCount: engine.setters.getSettersMap().size,
    remoteMaterialCount: engine.remote.registry.materialCount,
    remoteSetterCount: engine.remote.registry.setterCount,
  })
}
```

这些值适合不变量检查和测试，不授予 registry 修改权或回滚权限。

## 信任边界

### 策略

`createEngine()` 默认使用 `agentRestricted`，拒绝可执行 Schema、callback transaction、原始模型直写、插件原型扩展和远程访问。`legacyTrusted` 只为依赖旧插件或 UMD 的受信宿主提供兼容，不是沙箱。

当前 `DashboardPlugin` 依赖同 Realm 原型扩展，因此 Dashboard 兼容宿主需要显式使用 `legacyTrusted`。受限引擎必须与这类代码隔离在不同 Worker、iframe 或 Realm 中。

### Agent 执行权

`issue()` 返回的同 Realm capability 可以执行；`issuePort()` 默认 `executionAuthority: 'peer'`，连接端也可以执行。只有显式选择 `'host'`，才能把执行权保留在宿主：

```ts
import type {
  AgentCapabilityGrantInput,
  AgentPortSession,
  EngineInstance,
} from '@easy-editor/core/instance'

export function issueHostApprovedPort(
  engine: EngineInstance,
  port: MessagePort,
  signal: AbortSignal,
  grant: AgentCapabilityGrantInput,
): AgentPortSession {
  return engine.agentCapabilities.issuePort(grant, port, {
    executionAuthority: 'host',
    signal,
  })
}
```

连接端仍可 `snapshot()` 和 `preview()`，但 `execute()` 会被拒绝。宿主应读取 `session.getPreparedPlanPreview(planId)` 返回的 Core 权威 preview，完成自己的策略或用户确认后再调用 `session.approveAndExecute(planId)`。该调用只能证明宿主入口批准过，不能证明某个具体用户身份。

### 远程资源

远程访问必须同时通过：

1. `trustPolicy` 的 remote capability；
2. 宿主 `RemoteAdapter` 对资源名、类型、URL 和版本的 allowlist。

`engine.remote.registry` 只暴露只读资源 envelope；其中 `data` 仍是 adapter 拥有的不透明 capability。实例销毁时 adapter、加载状态和 registry 会统一清理。

## 旧模型 API 的兼容地位

为支持现有渲染器和 `legacyTrusted` 应用，包仍导出 Designer、Project、Document、Node、Selection、Event 和 Simulator 相关类型。它们的公开存在不等于其全部方法都是稳定的 v2 写 API。本参考不再为这些遗留对象承诺方法清单；迁移代码应把读取限制在渲染适配层，把业务写入收束到 EngineInstance 边界。

## 根入口 facade

`@easy-editor/core` 根入口仍导出 `defaultEngine`、`init`、`destroy`、`project` 等 v1 facade。它们指向一个进程级 `legacyTrusted` 默认实例，只用于渐进迁移：

- 不提供多实例隔离；
- 不能与显式实例的模块交叉使用；
- 使用后仍必须等待 `destroy()`；
- 新应用和 Agent 宿主应从 `@easy-editor/core/instance` 创建实例。

完整步骤见[从 v1 迁移到 v2](/guide/migration-v2)和[引擎所有权与信任边界](/design/overview)。
