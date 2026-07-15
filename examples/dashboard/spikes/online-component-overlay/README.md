# Online component overlay — Phase 0 browser spike

This throwaway spike freezes the surface contract without enabling the Phase 1 runtime or changing the Dashboard's default behavior.

## Chosen contract

- The host passes an explicit `data-easy-editor-surface-overlay-mount` element. The spike never discovers a viewport through a private CSS selector; it derives the viewport only from the stable mount parent.
- The generated root mounts **inside that seam**, so canvas-local rectangles inherit the viewport scroll, zoom, resize, clipping, and device-pixel transform.
- Each mounted surface owns exactly one `sandbox="allow-scripts"` iframe. Editor and standalone `/preview` surfaces therefore have independent coordinators and failure domains.
- All generated visuals share one plane above normal materials. Arbitrary per-instance interleaving with normal materials is intentionally unsupported.
- Real editor BemTools remain above the generated plane through the explicit `data-easy-editor-surface-tools` seam. Trusted per-instance editor shells select the renderer-provided `__id`; generated iframe DOM never receives selection authority.
- The iframe and empty overlay regions use `pointer-events:none`, so ordinary material regions click through. Preview shells bridge only an allowlisted normalized `activate` event and never expose selection or drag behavior.
- Native generated-component focus, keyboard/input, and drag/drop are intentionally unsupported by this contract.

## Security and performance boundary

The sandbox, CSP, opaque origin, session nonce, and `MessageChannel` demonstrate **authority containment**: generated code does not receive the host realm, Engine, Document, History, storage, credentials, or low-code tools.

An injected revision-keyed marker store writes pending before a normal activation and clears it only after the iframe READY heartbeat. A leftover pending marker quarantines reload before DOM effects. Safe boot also skips generated activation before DOM effects, leaving the editor available for rollback.

This does **not** demonstrate strong availability or synchronous CPU containment. A same-tab sandbox iframe can still block the renderer with hostile synchronous JavaScript such as an infinite loop. Cooperative lifecycle watchdogs may detect timeouts or message storms, but they cannot preempt that loop. Strong CPU containment requires a different process/origin or a restricted renderer protocol and is outside Phase 0.

## Evidence

- `test/online-component-overlay-spike-contract.test.mjs` freezes coordinate projection, sandbox boundaries, pending-to-heartbeat clear, pending persistence without heartbeat, stale quarantine, and safe-boot skip.
- `e2e/online-component-overlay-spike.spec.ts` mounts the same spike in the real editor viewport and standalone `/preview` viewport, verifies one independent iframe per surface, scaled coordinates, layering, click-through, editor selection, preview event normalization, and disposal isolation.
- `spikes/online-component-overlay/playwright.config.ts` runs the spike on isolated port `4186` so an unrelated local service on the repository's default `5173` port cannot be mistaken for Dashboard evidence.
