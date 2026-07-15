# 渲染模块

渲染模块把已经准备好的 Schema、组件表和宿主上下文转换为具体框架视图。运行态、预览态画布和 `SimulatorRenderer` 是**模型的消费者和画布适配器**，不是 Project 的所有者，也不拥有模型写权限。当前 `SettingRenderer` 仍保留通过 `SettingField` 直接写值的 `legacyTrusted` 兼容链；它不是新的稳定写入 API，新增写操作应收束为 intent、类型化命令和事务。

:::info 当前发布范围
当前仓库交付 React 渲染链。跨框架是架构目标，但尚未形成经过一致性测试的稳定 SPI。Agent Runtime 及其 UI/传输不属于当前渲染基线。
:::

## 1. 分层职责

```mermaid
flowchart LR
  Schema[RootSchema / NodeSchema] --> Core[renderer-core]
  Components[Components map] --> Adapter[framework adapter]
  Policy[ExpressionEvaluator] --> Core
  Core --> React[@easy-editor/react-renderer]
  React --> Runtime[运行态 / 预览]
  React --> Bridge[@easy-editor/react-renderer-dashboard]
  Simulator[Core Simulator] <--> Bridge
  Bridge --> Canvas[设计态画布 DOM]
```

| 包/接口 | 职责 | 不负责 |
| --- | --- | --- |
| `@easy-editor/renderer-core` | 共享类型、数据帮助函数、日志边界、显式表达式策略 | DOM root、React 生命周期、Project 写入 |
| `@easy-editor/react-renderer` | React 基础/Page/Component renderer、renderer factory、设置面板 renderer；后者暂含 `SettingField` 直接写值的兼容路径 | Engine 生命周期、远程授权、新的模型写入协议 |
| `@easy-editor/react-renderer-dashboard` | Dashboard 运行态/预览 renderer 与 `SimulatorRenderer` 桥接 | 通用跨框架 SPI、Schema 信任判定 |
| Core `SimulatorRenderer` | Designer 与画布之间的最小兼容接口 | 规定 React/Vue 组件模型 |

`renderer-core` 中的 `GeneralComponent` 只是共享类型的最小公分母；它不证明其他框架实现已经达到 React 适配器的功能等价。

## 2. 输入与输出契约

渲染入口的主要输入包括：

- `schema`：一个 `RootSchema` 或 `NodeSchema`；
- `components`：`componentName -> ComponentType` 映射；
- `designMode`：`design`、`preview` 或 `live`；
- `appHelper`：宿主提供的 utils、constants、路由和数据源适配；
- `expressionEvaluator`：执行 Schema 表达式的显式策略；
- 可选的 not-found、fault、viewport 与组件 ref 回调。

输出是具体框架拥有的视图树。设计态还通过 `SimulatorRenderer` 回报组件实例和 DOM 几何信息，以支持选区、拖拽、定位和滚动。

渲染器不接受“半可信 Schema 并顺便执行”。Project Schema 应先经过 Core 的结构、版本、迁移和信任策略检查；渲染阶段只消费准备完成的数据。

## 3. 运行态、预览态与设计态

### 3.1 运行态

运行态 renderer 根据 `schema.componentName` 查找组件，递归解析 props、条件、循环和 children，并将 `appHelper` 组合到渲染上下文。缺失组件和组件异常分别进入 not-found 与 fault 组件。

运行态只需要 Schema 与组件表，不需要 Engine 或 Designer。生产预览应优先使用这一较窄边界。

### 3.2 预览态

Dashboard 的 `PureRenderer` 在运行态之上增加多页面导航和项目级输入。它仍是视图组合，不拥有编辑器模型；需要保存的状态必须回到宿主持久化边界。

### 3.3 设计态

设计态由 `Simulator` 与 `SimulatorRenderer` 双向连接：

```text
Project/Document 只读投影
  -> Simulator 响应式输入
  -> SimulatorRendererContainer
  -> React root / DocumentInstance
  -> 组件 ref 与 DOM rect 回报
  -> Designer 选择、拖拽和定位
```

`SimulatorRendererContainer` 为一次挂载创建自己的 history、DocumentInstance、React root 和订阅集合。`mount()` / `run()` / `dispose()` 必须作用于同一个 renderer composition；DOM 容器使用所有权租约，不能被两个 Engine 同时接管。

## 4. 所有权与生命周期

1. 宿主创建并拥有 Engine；Engine 拥有 Designer、Project 和 Simulator。
2. 具体渲染器组合拥有自己的 `RendererAdapter`、框架 root 和视图订阅。
3. Simulator 连接 renderer，但不把 Engine 的清理权交给 renderer。
4. Engine 销毁时先停止 simulator/renderer 代，再销毁插件、Designer 和模型。
5. renderer `dispose()` 必须幂等释放 React root、history listener、autorun/reaction、DocumentInstance 与临时 DOM 容器。
6. 旧 renderer 或 DocumentInstance 不能连接到重新初始化后的 Engine 代。

React renderer 的 `createRendererAdapter()` 返回独立实例，避免进程级可变 renderer 表。组合多个 renderer 时，每个组合都应显式创建 adapter，不能依赖导入顺序修改共享单例。

## 5. 表达式与信任规则

Schema 中的 `JSExpression`、`JSFunction`、生命周期和数据源 handler 都可能执行代码。渲染器要求显式 `ExpressionEvaluator`：

- 未提供 evaluator 时 fail closed；
- `createDenyExpressionEvaluator()` 明确拒绝执行；
- `createTrustedExpressionEvaluator()` / `legacyTrustedExpressionEvaluator` 只适用于宿主明确受信的 Schema；
- evaluator 错误统一为带 code 和非敏感 details 的 `ExpressionEvaluationError` / `PolicyViolation`。

`createTrustedExpressionEvaluator()` 最终仍在当前 Realm 使用动态函数执行。它不是沙箱，`allowScopeAccess` 也只是兼容旧 `with(scope)` 语义。运行不可信表达式必须使用独立 Realm、Worker、iframe 或进程，并限制可传入 binding。

组件实现、`appHelper.utils`、数据源引擎、custom element hook 和 renderer 回调同样是可执行能力。它们应由宿主构造，不应直接来自未经验证的远程数据。

## 6. 远程物料边界

渲染器只消费已经注册到 materials 的组件实现和元数据。远程组件的网络请求、脚本/样式插入、版本 allowlist 与资源回收必须在渲染前经过：

```text
trustPolicy.allowRemoteAccess
  -> host RemoteAdapter authorization
  -> ResourceRegistry / LoadingState
  -> Materials registration
  -> renderer components map
```

把一个 URL 放进 Schema 或 `componentsMap` 不会自动授予加载权限。旧 UMD 在 `legacyTrusted` 同 Realm 中产生的全局变量和原型副作用也不属于 renderer 可撤销资源。

## 7. 稳定、兼容与内部边界

| 层级 | 当前定位 |
| --- | --- |
| 稳定包入口 | 三个 renderer 包的顶层 exports、`RendererProps`、`ExpressionEvaluator` 与已发布 factory |
| 设计态兼容接口 | Core `SimulatorRenderer`、`RendererProps.__host` / `__container` 等桥接字段 |
| Dashboard 场景实现 | Dashboard 的布局、多页面 history、DocumentInstance 与 DOM 查找策略 |
| 内部实现 | `__schema`、`__components`、`__ctx`、React key/cache、container lease、私有 render state |

带 `__` 的 props 用于 renderer 层之间的适配，不是业务组件的稳定宿主 API。业务组件不应读取或修改这些字段。

`SimulatorRenderer` 当前包含 DOM `Element`、`Text` 和 `DOMRect` 语义，因此只能视为 Web Designer 兼容接口；在宣称跨平台稳定 SPI 前，需要再抽离几何、实例句柄和事件协议。

## 8. 扩展缝

- **组件映射**：通过 materials 或运行态 `components` 注入组件实现；
- **React renderer adapter**：用独立 `RendererAdapter` 组合 Base/Page/Component renderer；
- **错误表现**：提供 `notFoundComponent` 与 `faultComponent`；
- **上下文**：通过窄化的 `appHelper` 注入 utils/constants/data source；
- **表达式策略**：注入 `ExpressionEvaluator`，而不是修改 renderer 内部 parser；
- **设计态桥接**：实现 `SimulatorRenderer` 并满足 mount/run/dispose 与实例查询契约。

新的框架适配器应先建立 conformance tests，至少覆盖 Schema 递归、条件/循环、表达式拒绝、错误边界、组件实例映射、设计态 suspend 和销毁；不能只实现“能显示页面”就宣称多框架等价。

## 9. 验证方式

| 契约 | 测试族 |
| --- | --- |
| adapter 实例隔离 | `react-renderer/adapter-instance` |
| 表达式策略与错误归一化 | `renderer-core/expression-evaluator`、`policy-boundary` |
| 数据加载 settle 语义 | `renderer-core/data-helper-settlement` |
| 日志不泄漏敏感内容 | `renderer-core/logging-boundary` |
| 缺失 Setter 降级 | `react-renderer/setting-setter-missing` |
| Dashboard renderer 所有权和销毁 | `simulator-renderer-ownership`、`instance-services` |
| 发布声明边界 | `declaration-sanitizer`、各包 `test-types` |

仓库级浏览器测试还应启动 Dashboard，验证真实挂载、刷新、非持久 `pagehide` 销毁、预览窗口和控制台错误；纯 Node 测试不能替代 DOM 生命周期验证。

## 10. 已知限制

- 当前只交付 React renderer；Vue、原生应用或服务端 renderer 尚未达到发布状态。
- `renderer-core` 仍包含面向现有低代码协议的兼容类型，尚不是完整的跨框架 IR。
- Dashboard renderer 与 DOM、React Router、MobX 和浏览器 history 紧密耦合。
- 运行态数据源与组件生命周期仍可能执行宿主代码，必须由显式表达式策略和宿主信任模型约束。
- 设计态 `SimulatorRenderer` 是兼容接口，尚未具有独立的版本化 conformance suite。
- Agent Runtime、Agent UI 和 Agent transport 未随当前渲染基线发布。

使用方法见[渲染器开发](/guide/renderer/)，总体信任模型见[架构综述](/design/overview)。
