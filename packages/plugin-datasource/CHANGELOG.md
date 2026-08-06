# @easy-editor/plugin-datasource

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

### Patch Changes

- Updated dependencies [9606415]
  - @easy-editor/core@2.0.0

## 1.0.5

### Patch Changes

- 82e7377: fix: build error
- Updated dependencies [dfd68c7]
- Updated dependencies [48ab2d3]
- Updated dependencies [3baf4e7]
- Updated dependencies [bdbe9f5]
- Updated dependencies [e0ba706]
- Updated dependencies [755bcd5]
- Updated dependencies [0853432]
- Updated dependencies [0d14474]
- Updated dependencies [f3b3afc]
- Updated dependencies [d572551]
- Updated dependencies [7577e40]
- Updated dependencies [2c56ebc]
- Updated dependencies [c616486]
  - @easy-editor/core@1.0.3

## 1.0.4

### Patch Changes

- 39d7240: fix: datasource options miss

## 1.0.3

### Patch Changes

- 8786383: perf: export createDataSourceEngine

## 1.0.2

### Patch Changes

- 638425a: types: perform DataSource
- Updated dependencies [638425a]
- Updated dependencies [5afd68c]
  - @easy-editor/core@1.0.2

## 1.0.1

### Patch Changes

- 8b51e73: perf: detach dataSource
- 7ffae3c: perf: core provide DataSource interface
- 90c6910: perf: plugin extend mobx
- Updated dependencies [7ffae3c]
- Updated dependencies [90c6910]
- Updated dependencies [49ef13e]
  - @easy-editor/core@1.0.1

## 1.0.0

### Patch Changes

- 262342d: V1.0.0

  - Core architecture refactoring, optimized plugin architecture, improved modularity and extensibility
  - Refactored renderer, extracted and added renderer core renderer-core
  - Added data source plugin plugin-datasource
  - Improved Dashboard plugin, supporting element positioning, grouping and guidelines
  - API changes: createEasyEditor → init, ComponentMetaManager → Materials, PluginManager → Plugins, SetterManager → Setters, ...
  - Other bug fixes...

- Updated dependencies [262342d]
  - @easy-editor/core@1.0.0
