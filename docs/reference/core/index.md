# Core API

EasyEditor v2 的稳定框架边界是宿主拥有的 `EngineInstance`。实例把生命周期、插件、物料、设置器、项目替换、命令事务和远程资源收束到同一个所有权边界中。

## 公共契约层级

| 层级 | 入口或表面 | 承诺 |
| --- | --- | --- |
| **Stable** | `@easy-editor/core/instance` | 工厂创建的实例生命周期、Schema 校验、命令、事务和宿主注册 API |
| **Compatibility（Web adapter）** | Designer、Project、Document、Node、Event 和面向 DOM 的 Simulator 类型 | 用于现有 Web 渲染器和读取集成；原始模型修改方法不是稳定的 v2 写入 API |
| **Deferred / Internal** | Agent 实验和具体引擎实现 | Agent Runtime 不属于本轮框架收束；具体构造和可变服务注入不是公共 API |

根入口 `@easy-editor/core` 是 v1 迁移 facade，不属于 Stable 实例契约。

`@easy-editor/core/instance` 使用显式、有限的导出清单。宿主只能通过 `createEngine()` 取得 `EngineInstance`；具体引擎类、可变服务注入和生命周期内部能力不对外导出。

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

`ConfigOptions.designMode` 只接受 `'design' | 'live'`。初始化成功后 `lifecycleState` 为 `ready`。正在初始化或销毁时再调用 `init()` 会立即以 `LifecycleReentrancyError` 拒绝；它不会合并 Promise，也不会自动等待。宿主必须等待原操作完成后显式重试。对 `ready` 实例再次调用 `init()` 是已解决的空操作，不会应用新 options；需要新运行代时必须先显式 `destroy()`。

### `engine.destroy()`

**类型：** `() => Promise<void>`

```ts
import type { EngineInstance } from '@easy-editor/core/instance'

export function destroyEngine(engine: EngineInstance): Promise<void> {
  return engine.destroy()
}
```

`destroy()` 会阻止新写入，并清理实例拥有的插件、监听器、Designer、Project、热键、物料、设置器、远程 adapter/registry、事件及内部资源。正在初始化或销毁时再调用 `destroy()` 会立即以 `LifecycleReentrancyError` 拒绝；它不会合并或自动等待。宿主必须等待原操作完成后显式重试。清理失败时状态进入 `failed`，再次调用会重试保留的未完成清理。对 `disposed` 实例调用 `destroy()` 是已解决的空操作。

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

### 生命周期状态 × 公共操作

| 状态 | `init()` | `destroy()` | 其他公共操作 |
| --- | --- | --- | --- |
| `created` | 开始初始化 | 销毁尚未初始化的实例 | 允许宿主配置和注册；应用模型操作应等待 `ready` |
| `initializing` | 拒绝；等待原 `init()` 后再按需重试 | 拒绝；等待原 `init()` 后再显式销毁 | 不是宿主受支持的操作窗口 |
| `ready` | 已解决的空操作；不应用新 options | 开始销毁 | 按信任、所有权和事务规则允许 |
| `disposing` | 拒绝；等待原 `destroy()` 后重试 | 拒绝；等待原 `destroy()` | 拒绝新写入和订阅 |
| `disposed` | 开始新运行代 | 已解决的空操作 | 在成功 `init()` 前拒绝 |
| `failed` | 拒绝 | 重试保留的清理；成功后进入 `disposed` | 清理成功并重新初始化前拒绝 |

初始化失败且回滚完整时返回 `created`；回滚不完整时进入 `failed`。活跃事务、引擎拥有的生命周期回调或宿主模型回调中也不得调用生命周期方法。

### 生命周期回调约束

插件的 `init` / `extend` / `destroy` 与 `RemoteAdapter.init()` / `dispose()` 都是引擎拥有的生命周期回调。它们**不得**调用同一引擎的 `init()` 或 `destroy()`；直接同步重入会抛出 `LifecycleReentrancyError`。受限 PluginContext 不暴露引擎生命周期方法。

同 Realm JavaScript 在没有 AsyncContext 类因果跟踪或 Realm/进程隔离时，无法可靠区分“外部宿主调用”和“回调在 `await` 后通过预先捕获的原始引擎闭包调用”。因此插件或 adapter 不得在异步挂起后这样调用生命周期；这是宿主扩展协议约束，不是安全沙箱能够兜底的场景。

## 实例模块

| 模块 | 责任 |
| --- | --- |
| `plugins` | 宿主异步注册/删除插件并读取冻结状态；排序、初始化和销毁由引擎拥有 |
| `materials` | 注册组件元数据，并提供可验证 registry 快照 |
| `setters` | 注册设置器，并提供稳定的只读 Map facade |
| `project` / `designer` | 渲染器集成与旧模型读取；不是新的稳定直写边界 |
| `commands` / `transactions` | 可验证、可回滚、可审计的模型写入 |
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
- `engine.plugins.get()` / `getAll()` 只返回冻结状态，不暴露 `PluginRuntime`、Context 或生命周期方法。
- `engine.plugins.getExports(name)` 返回代际绑定的只读导出 facade；销毁后保留的可调用导出会失效。
- 受限策略下，插件 Context 的根能力是有限 facade：不提供引擎生命周期，并省略已知的反向权限字段；其中 `PluginRegistry` 只读，不能通过该 registry 注册或删除其他插件。这里描述的是 Context 表面，而不是对任意同 Realm 代码的隔离承诺。

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

`createEngine()` 默认使用 `agentRestricted`。它是 capability、输入校验与模型修改策略：通过受限框架表面拒绝可执行 Schema、callback transaction、直接原始模型写入、插件原型扩展和远程访问，并向插件提供有限根 facade。它不是用来执行恶意插件的安全沙箱。

同 Realm 插件与宿主提供的 `RemoteAdapter` 都是受信扩展代码；它们仍可使用自己捕获的闭包、导入和全局对象。`legacyTrusted` 只为依赖旧插件或 UMD 的受信宿主提供更宽的兼容表面；两种策略都不提供进程、iframe、Realm 或 SES 隔离。

当前 `DashboardPlugin` 依赖同 Realm 原型扩展，因此 Dashboard 兼容宿主需要显式使用 `legacyTrusted`。活动原型租约与受限引擎必须隔离在不同 Worker、iframe 或 Realm；最后一个兼容引擎成功销毁并恢复描述符后，同一 Realm 才可顺序创建受限引擎。

### Agent 阶段暂缓

Agent Runtime、传输、授权和审批协议不属于本阶段的 Stable 框架契约，也不从 `EngineInstance` 表面获得稳定承诺。现有实验入口会在框架契约稳定后的 Agent 阶段单独审视。

### 远程资源

远程访问必须同时通过：

1. `trustPolicy` 的 remote capability；
2. 宿主 `RemoteAdapter` 对资源名、类型、URL 和版本的 allowlist。

`engine.remote.registry` 只暴露只读资源 envelope；其中 `data` 仍是 adapter 拥有的不透明 capability。实例销毁时 adapter、加载状态和 registry 会统一清理。

`RemoteAdapter` 是宿主提供的受信扩展。其 `init()` / `dispose()` 不能调用同一引擎的生命周期，也不能捕获原始引擎后在 `await` 之后发起这类调用。

## 旧模型 API 的兼容地位

为支持现有渲染器和 `legacyTrusted` 应用，包仍导出 Designer、Project、Document、Node、Selection、Event 和 Simulator 相关类型。它们的公开存在不等于其全部方法都是稳定的 v2 写 API。本参考不再为这些遗留对象承诺方法清单；迁移代码应把读取限制在渲染适配层，把业务写入收束到 EngineInstance 边界。

## 支持与验证矩阵

| 表面 | 支持契约 | 当前验证状态 |
| --- | --- | --- |
| 框架运行时包与仓库工具 | Node.js `>=18.20.8` | CI 在精确最低版本运行质量门禁；Node 20 是 strict-engine 主车道 |
| `@easy-editor/easypack` | Node.js `>=20.0.0` | 只在 Node 20 车道验证 |
| 仓库包管理器 | pnpm `>=9.12.2`；CI 与 lockfile 使用 pnpm `10.25.0` | CI 使用 frozen lockfile 安装 |
| 渲染器 | 已交付 React 渲染器 | 其他框架是扩展目标，不是已交付支持 |
| 浏览器 | 通过 `pnpm example:dashboard` 进行 Dashboard 开发验证 | Chromium 人工 smoke；自动浏览器 E2E 尚未进入发布门禁 |
| 操作系统 | 包应保持平台无关 | Ubuntu 运行全量门禁；macOS 与 Windows 运行 generator 和 packed-template 发布 smoke |

## 根入口 facade

`@easy-editor/core` 根入口仍导出 `defaultEngine`、`init`、`destroy`、`project` 等 v1 facade。它们指向一个进程级 `legacyTrusted` 默认实例，只用于渐进迁移：

- 不提供多实例隔离；
- 不能与显式实例的模块交叉使用；
- 使用后仍必须等待 `destroy()`；
- 新应用应从 `@easy-editor/core/instance` 创建实例；Agent 相关契约留待后续阶段单独设计。

完整步骤见[从 v1 迁移到 v2](/guide/migration-v2)和[引擎所有权与信任边界](/design/overview)。
