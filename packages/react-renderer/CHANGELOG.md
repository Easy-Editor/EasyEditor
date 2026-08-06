# @easy-editor/react-renderer

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
  - @easy-editor/renderer-core@2.0.0

## 1.0.3

### Patch Changes

- 48ab2d3: feat: support multi-version component
- e6c2c05: fix: miss use ComponentRenderer
- 3baf4e7: fix: ErrorComponent in Dashboard display error
- 82e7377: fix: build error
- 0d14474: feat: load remote materials
- d572551: perf: setting-rednerer
- c616486: feat: remote component load logic
- Updated dependencies [dfd68c7]
- Updated dependencies [48ab2d3]
- Updated dependencies [3baf4e7]
- Updated dependencies [bdbe9f5]
- Updated dependencies [e0ba706]
- Updated dependencies [755bcd5]
- Updated dependencies [82e7377]
- Updated dependencies [0853432]
- Updated dependencies [0d14474]
- Updated dependencies [f3b3afc]
- Updated dependencies [d572551]
- Updated dependencies [7577e40]
- Updated dependencies [2c56ebc]
- Updated dependencies [c616486]
  - @easy-editor/core@1.0.3
  - @easy-editor/renderer-core@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [638425a]
- Updated dependencies [5afd68c]
  - @easy-editor/core@1.0.2
  - @easy-editor/renderer-core@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [7ffae3c]
- Updated dependencies [90c6910]
- Updated dependencies [49ef13e]
  - @easy-editor/core@1.0.1
  - @easy-editor/renderer-core@1.0.1

## 1.0.0

### Major Changes

- 262342d: V1.0.0

  - Core architecture refactoring, optimized plugin architecture, improved modularity and extensibility
  - Refactored renderer, extracted and added renderer core renderer-core
  - Added data source plugin plugin-datasource
  - Improved Dashboard plugin, supporting element positioning, grouping and guidelines
  - API changes: createEasyEditor → init, ComponentMetaManager → Materials, PluginManager → Plugins, SetterManager → Setters, ...
  - Other bug fixes...

### Patch Changes

- Updated dependencies [262342d]
  - @easy-editor/renderer-core@1.0.0
  - @easy-editor/core@1.0.0

## 0.0.18

### Patch Changes

- c94cef8: feat: add datasource
- Updated dependencies [25fdeea]
- Updated dependencies [c94cef8]
  - @easy-editor/core@0.0.16
  - @easy-editor/datasource-engine@0.0.1

## 0.0.17

### Patch Changes

- Updated dependencies [f4f4b3e]
  - @easy-editor/core@0.0.15

## 0.0.16

### Patch Changes

- 145a271: chore: dependencies upgrade

## 0.0.15

### Patch Changes

- 014991a: fix: run \_\_executeLifeCycleMethod error

## 0.0.14

### Patch Changes

- e612dad: feat: add excuteLifeCycleInDesign
- Updated dependencies [f753cfe]
- Updated dependencies [e612dad]
  - @easy-editor/core@0.0.14

## 0.0.13

### Patch Changes

- Updated dependencies [f0a103a]
- Updated dependencies [5287320]
- Updated dependencies [cc48de5]
  - @easy-editor/core@0.0.13

## 0.0.12

### Patch Changes

- Updated dependencies [8560d49]
  - @easy-editor/core@0.0.12

## 0.0.11

### Patch Changes

- Updated dependencies [9d5d085]
  - @easy-editor/core@0.0.11

## 0.0.10

### Patch Changes

- Updated dependencies [f0dc7d1]
- Updated dependencies [b3666f5]
  - @easy-editor/core@0.0.10

## 0.0.9

### Patch Changes

- 944bc94: feat: field setValue add oldValue
- Updated dependencies [944bc94]
  - @easy-editor/core@0.0.9

## 0.0.8

### Patch Changes

- 5d41297: perf: add some prop
- Updated dependencies [5d41297]
  - @easy-editor/core@0.0.8

## 0.0.7

### Patch Changes

- Updated dependencies [13293b6]
  - @easy-editor/core@0.0.7

## 0.0.6

### Patch Changes

- Updated dependencies [62a83ed]
  - @easy-editor/core@0.0.6

## 0.0.5

### Patch Changes

- 6682a96: build: perf bundle size

## 0.0.4

### Patch Changes

- 8a49484: build: perf build workflow
- Updated dependencies [8a49484]
  - @easy-editor/core@0.0.5

## 0.0.3

### Patch Changes

- Updated dependencies [29cf0a6]
  - @easy-editor/core@0.0.4

## 0.0.2

### Patch Changes

- da54175: perf: remove thisRequiredInJSE
- ca396de: feat: update
- d59eab1: chore: remove package's CHANGELOG.md
- 2d0a1fa: build: move mobx,mobx-react to peerDependencies
- Updated dependencies [da54175]
- Updated dependencies [ca396de]
- Updated dependencies [d59eab1]
- Updated dependencies [0c4970d]
- Updated dependencies [2d0a1fa]
  - @easy-editor/core@0.0.3

## 0.0.2-alpha.2

### Patch Changes

- Updated dependencies [bd41334]
  - @easy-editor/core@0.0.3-alpha.2

## 0.0.2-alpha.1

### Patch Changes

- 92574e0: perf: remove thisRequiredInJSE
- 1c9ec92: chore: remove package's CHANGELOG.md
- 6f282a3: build: move mobx,mobx-react to peerDependencies
- Updated dependencies [92574e0]
- Updated dependencies [1c9ec92]
- Updated dependencies [6f282a3]
  - @easy-editor/core@0.0.3-alpha.1

## 0.0.2-alpha.0

### Patch Changes

- 3f130ae: test: build alpha
- Updated dependencies [3f130ae]
  - @easy-editor/core@0.0.3-alpha.0

## 0.0.1

### Patch Changes

- 9a2c9ae: feat: all packages publish
- Updated dependencies [9a2c9ae]
  - @easy-editor/core@0.0.2
