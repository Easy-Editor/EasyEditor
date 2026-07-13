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

- `init()` 和 `destroy()` 都返回 Promise；并发调用会等待当前操作。
- `destroy()` 清理实例拥有的插件、监听器、热键、文档、物料、设置器和远程资源。
- 销毁失败时状态进入 `failed`；再次调用 `destroy()` 会重试未完成的清理。
- 不要直接调用 `engine.materials.dispose()`、`engine.setters.dispose()` 等子服务清理方法。引擎拥有的服务必须由 `engine.destroy()` 统一销毁。

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
| 适用场景 | 新宿主、Agent 能力端 | 依赖旧插件或 UMD 的现有 Dashboard |

当前 `DashboardPlugin` 仍依赖同 Realm 原型扩展，因此迁移现有 Dashboard 时需要显式选择：

```ts
const engine = createEngine({
  trustPolicy: 'legacyTrusted',
  hostWindow: window,
})
```

`legacyTrusted` 是兼容模式，不是沙箱。旧 UMD 或原型扩展可能留下无法通过移除 `<script>` 撤销的进程级副作用。受限引擎与这类代码应运行在不同 Worker、iframe 或 Realm 中。

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

## 6. 收紧 Agent 与远程运行时边界

### Agent

Agent 不应持有 `Project`、`Document` 或 `Node` 引用。宿主应签发最小 capability，限定文档、命令、组件、prop、额外字段和大小上限。执行权由 capability 的交付方式决定：

- `engine.agentCapabilities.issue(grant)` 返回同 Realm capability；持有者可以直接调用 `execute(planId)`。
- `issuePort(grant, port, { signal })` 的 `executionAuthority` 默认为 `'peer'`；连接端同样可以调用 `execute(planId)`。
- 只有显式设置 `executionAuthority: 'host'`，才会拒绝连接端的 `execute()`，并要求可信宿主先读取 Core 保存的 authoritative preview，再调用 `approveAndExecute(planId)`。

下面的宿主代码创建强制宿主批准的 Worker 通道：

```ts
import type {
  AgentCapabilityGrantInput,
  EngineInstance,
} from '@easy-editor/core/instance'

export function openHostApprovedAgentSession(
  engine: EngineInstance,
  worker: Worker,
  grant: AgentCapabilityGrantInput,
) {
  const channel = new MessageChannel()
  const controller = new AbortController()
  const session = engine.agentCapabilities.issuePort(grant, channel.port1, {
    executionAuthority: 'host',
    signal: controller.signal,
  })

  worker.postMessage(
    { type: 'easy-editor-agent-port', port: channel.port2 },
    [channel.port2],
  )

  return {
    inspect(planId: string) {
      return session.getPreparedPlanPreview(planId)
    },
    approve(planId: string) {
      return session.approveAndExecute(planId)
    },
    close() {
      session.close()
      controller.abort()
    },
  }
}
```

Worker 端只能获得结构化克隆后的 object capability：

```ts
import { connectAgentPort } from '@easy-editor/core/agent-channel'

export async function connectAgentCapability(port: MessagePort) {
  return connectAgentPort(port)
}
```

在 `'host'` 模式中，Worker 可以执行 `snapshot()` 与 `preview()`，但 `execute()` 会 fail closed。宿主必须根据 `session.getPreparedPlanPreview(planId)` 返回的 Core 权威数据做授权判断，不能信任 Agent 回传的 effects。`approveAndExecute()` 只能证明可信宿主入口执行了批准，不能证明某个具体用户身份，也不能消除画布文本中的提示注入；Worker 隔离与 capability 策略必须同时存在。

### 远程资源

远程访问必须经过两层边界：

1. `trustPolicy` 先决定是否允许 remote capability；
2. 宿主提供的 `RemoteAdapter` 再校验资源名、类型、URL 和版本 allowlist。

不要把“资源已登记”当作“资源可信”。`engine.remote.registry` 只记录已加载资源的只读 envelope，其中 `data` 仍是 adapter 拥有的不透明能力对象。销毁实例时 adapter、加载状态和 registry 会由 `engine.destroy()` 统一清理。

## 7. 默认 facade 的兼容边界

根入口仍保留 v1 facade：

```ts
import { defaultEngine, destroy, init, project } from '@easy-editor/core'
```

它是一个进程级 `legacyTrusted` 默认实例，仅用于渐进迁移：

- 不提供多实例隔离；
- 不应作为新应用或 Agent 宿主的默认入口；
- 不能与显式实例的模块引用混用；
- 使用后仍必须调用并等待 `destroy()`。

完成迁移的判断标准是：业务代码只从 `@easy-editor/core/instance` 获取运行时实例，所有资源都有明确所有者和销毁点，模型写入进入 Schema、command 或事务边界，所有不可信输入都在产生副作用前完成校验。

## 下一步

- [快速开始](/guide/getting-started)
- [Core API](/reference/core/)
- [引擎所有权与信任边界](/design/overview)
