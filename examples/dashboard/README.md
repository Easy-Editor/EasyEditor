# EasyEditor React Dashboard

## Engine Runtime Boundary

The Dashboard owns one explicit `EngineInstance` in `src/editor/runtime.ts`.
It uses `legacyTrusted` because the current Dashboard plugin chain and remote
UMD modules still rely on same-realm prototype/global behavior. This is an
explicit compatibility decision, not a sandbox claim.

Remote loaders are owned by the engine's `RemoteAdapter`. Policy checks happen
before network, DOM, or WebSocket effects; teardown aborts in-flight work and
removes the resources the adapter can actually own. UMD mutations to global
objects or prototypes cannot be reversed by removing their script elements.
For that reason, a destroyed Dashboard instance cannot safely reclaim an
already-loaded UMD global in the same JavaScript realm; HMR must perform a full
page reload before loading that global again. The Core engine itself is
re-instantiable, but this legacy UMD adapter remains an explicit compatibility
limit.

## Static Server

Run `pnpm build:only` and then `pnpm start` to serve the generated `dist`
directory. The dependency-free Node server serves immutable static assets,
returns `index.html` for client-side routes, and accepts `HOST` and `PORT` from
the process environment.

The server is intentionally limited to static Dashboard delivery. Application
APIs belong behind separately designed and reviewed host boundaries rather than
inside this framework example.
