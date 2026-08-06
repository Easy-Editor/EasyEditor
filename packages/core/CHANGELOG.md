# @easy-editor/core

## 2.0.0

### Major Changes

- 9606415: Establish the isolated, disposable, transactional engine instance boundary and migrate the Dashboard runtime graph and generated template to it.

  Close terminal and cross-generation mutation paths with runtime-private lifecycle state, runtime-locked model identity and authority references, engine-owned mutation barriers, generation-bound plugin capabilities, linearized plugin lifecycle operations, callback-safe host mutation authority, permanently revoked generation-scoped model references, and detached observer snapshots.

  Make legacy prototype extensions manager-owned, reference-counted leases that require matching runtime property identities, commit atomically, and restore original descriptors after the final owner is destroyed. Remove the DataSource plugin's unnecessary Project prototype extension so it can compose under the restricted policy.

  Make renderer and datasource expression evaluation fail closed unless a host explicitly supplies an evaluator. Replace shared renderer adapter/container state with instance-owned composition and wire the Dashboard editor, direct preview, and generated template to an explicit compatibility policy.

  Make plugin hotkey registrations context-owned binding leases so deletion, failed initialization, engine disposal, and restart release exact bindings through the internal teardown boundary without reopening revoked plugin capabilities. Normalize Dashboard and generated-template persistence to the current versioned project schema before preview validation.

  Order engine teardown by dependency phase so Simulator UI and monotonic React ref detachments settle before plugin and Designer dependencies are revoked, failed renderer cleanup keeps its settlement generation retryable, and Dashboard remote cleanup never mutates engine-owned registries during disposal.

  Set the verified Node 18.20.8 runtime and repository floor explicitly, while keeping build tooling that requires Node 20 isolated to the strict Node 20 CI lane.

  Keep the experimental Agent Runtime and Dashboard AI chain isolated from this framework release line. Core publishes only the legacy root facade and the stable `./instance` subpath; Agent transport, authorization, and approval contracts will be redesigned in a later phase.

  Release-gate the Dashboard lifecycle in Chromium and verify packed Core, renderer, plugin, generator, and Easypack artifacts through real temporary consumers before publication.

## 1.0.3

### Patch Changes

- dfd68c7: perf: bemtools experience
- 48ab2d3: feat: support multi-version component
- 3baf4e7: fix: ErrorComponent in Dashboard display error
- bdbe9f5: fix: project getComponentsMap error
- e0ba706: fix: node componentMeta error
- 755bcd5: feat: add node's refreshSettingEntry
- 0853432: feat: add resource-consumer & remoteMaterials
- 0d14474: feat: load remote materials
- f3b3afc: fix: checkSelect only left button
- d572551: perf: setting-rednerer
- 7577e40: refactor: materials logic
- 2c56ebc: fix: node usageCount error
- c616486: feat: remote component load logic

## 1.0.2

### Patch Changes

- 638425a: types: perform DataSource
- 5afd68c: fix: dataSourceEngine miss

## 1.0.1

### Patch Changes

- 7ffae3c: perf: core provide DataSource interface
- 90c6910: perf: plugin extend mobx
- 49ef13e: perf: detach dataSource

## 1.0.0

### Major Changes

- 262342d: V1.0.0

  - Core architecture refactoring, optimized plugin architecture, improved modularity and extensibility
  - Refactored renderer, extracted and added renderer core renderer-core
  - Added data source plugin plugin-datasource
  - Improved Dashboard plugin, supporting element positioning, grouping and guidelines
  - API changes: createEasyEditor → init, ComponentMetaManager → Materials, PluginManager → Plugins, SetterManager → Setters, ...
  - Other bug fixes...

## 0.0.16

### Patch Changes

- 25fdeea: feat: add core version
- c94cef8: feat: add datasource

## 0.0.15

### Patch Changes

- f4f4b3e: fix: Editor setters types error

## 0.0.14

### Patch Changes

- f753cfe: perf: setting-field setHotValue
- e612dad: feat: add excuteLifeCycleInDesign

## 0.0.13

### Patch Changes

- f0a103a: fix: document remove error
- 5287320: fix: project removeDocument deadCycle
- cc48de5: feat: project add getDocumentByFileName

## 0.0.12

### Patch Changes

- 8560d49: perf: document open logic

## 0.0.11

### Patch Changes

- 9d5d085: feat: node add level operation

## 0.0.10

### Patch Changes

- f0dc7d1: feat(core): add clearExtraPropValue
- b3666f5: fix: snippet's dnd loc error

## 0.0.9

### Patch Changes

- 944bc94: feat: field setValue add oldValue

## 0.0.8

### Patch Changes

- 5d41297: perf: add some prop

## 0.0.7

### Patch Changes

- 13293b6: fix: cancel default select rootNode

## 0.0.6

### Patch Changes

- 62a83ed: fix: cancel default select rootNode

## 0.0.5

### Patch Changes

- 8a49484: build: perf build workflow

## 0.0.4

### Patch Changes

- 29cf0a6: fix: naoid env error

## 0.0.3

### Patch Changes

- da54175: perf: remove thisRequiredInJSE
- ca396de: feat: update
- d59eab1: chore: remove package's CHANGELOG.md
- 0c4970d: fix: document.import error
- 2d0a1fa: build: move mobx,mobx-react to peerDependencies

## 0.0.3-alpha.2

### Patch Changes

- bd41334: fix: document.import error

## 0.0.3-alpha.1

### Patch Changes

- 92574e0: perf: remove thisRequiredInJSE
- 1c9ec92: chore: remove package's CHANGELOG.md
- 6f282a3: build: move mobx,mobx-react to peerDependencies

## 0.0.3-alpha.0

### Patch Changes

- 3f130ae: test: build alpha

## 0.0.2

### Patch Changes

- 9a2c9ae: feat: all packages publish

## 0.0.1

### Patch Changes

- 096c32d: feat: first publish
