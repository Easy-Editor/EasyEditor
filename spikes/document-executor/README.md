# Document Executor M0 spike

This spike starts one fresh headless Chromium and two fresh browser contexts
for every operation. The first context executes the candidate. The second has
a fresh page/module graph and proves candidate reload, a subsequent semantic
edit, and Core undo. Both open the independent Harness and use process-local
memory Host persistence.

Input is read from a JSON file argument or stdin:

```sh
node src/cli.mjs ./operation.json
```

The operation JSON cannot supply `dashboardUrl`. Library callers pass the
operator-owned origin as the second argument:

```js
executeDocument(operation, { dashboardUrl })
executeDocumentWorkflow(workflow, { dashboardUrl, artifactDirectory })
```

The CLI reads it from
`EASY_EDITOR_DOCUMENT_EXECUTOR_DASHBOARD_URL`, with the local development
origin used only as a default. This operator setting fails closed: only
credential-free `http` URLs on `127.0.0.1`, `localhost`, or `::1` are accepted,
and URL fragments are rejected.

The M0 Harness must be served from a Vite build with `VITE_E2E=1`. The Harness
is an immutable static artifact built with runtime enabled and data, online,
promotion, and remote-resource modes disabled. It statically embeds the editor,
runtime, and Dashboard Agent Host factory behind a frozen browser bridge. The
executor verifies the E2E/remote-disabled marker before either Host call. A real
`VITE_E2E=0` static build fails closed.

The default artifact directory is `.browser-dist`. `artifactDirectory` is an
operator-only library option used for isolated artifact verification; operation
input cannot select it. Normal tests serve the directory with `vite preview`,
and both browser contexts navigate `/index.html`. There is no Vite development
module graph, `/@fs` import, dynamic Host import, or React refresh preamble.

This is a spike-only isolation contract: production remote materials, fonts,
images, and generated components remain outside M0. Browser `/api` and
cross-origin requests are aborted, and the operation fails if any such request
is attempted; blocked resources are never accepted as a successful render.

The Node executor accepts a task grant token but no database credentials.
Input is recursively rejected for the exact database-credential keys in the
EasyDashboard Hono executor contract, and all operation/workflow input is also
recursively rejected if it contains either mutation or recovery authority.
Those grants never enter `page.evaluate`, browser storage, or Host arguments:
browser evaluation receives only the projected invocation fields needed by
the Harness. Workflow recovery grants are passed only through a Node-owned
authority-secret option.

Cookies, local storage, session storage, IndexedDB databases/stores/records,
and Cache Storage names are captured before and after execution in both fresh
browser contexts. Both contexts must begin completely empty. After the real
Dashboard persistence flush, session and Cache Storage remain empty; local
storage must equal the canonical legacy snapshot/compatibility closure; and
IndexedDB must equal the Dashboard store schema with one migration record, one
generation-2 autosave working draft matching that context's current candidate,
and the exact candidate-derived mutation-provenance closure. Every captured
key and value is recursively checked in Node for executor authority, database
credential keys, credential URLs, and credential-shaped values. No cleanup is
performed to make the check pass.

The optional Hono workflow checks durable outcome first, then performs `GET input -> PUT
prepared -> POST commit -> GET outcome` when execution is still required;
Bearer authority remains in Node. The five-minute `grantToken` is used only for
input/prepare/commit. The 24-hour exact `recoveryGrantToken` is used only for
outcome preflight and final outcome reads. Mutations include `Origin`,
`X-CSRF-Token: 1`, and JSON content type. Neither token enters the browser or
returned DTO, and the executor never receives database credentials or writes
project storage directly.

On restart, a durable `prepared` outcome retries only the CAS commit using its
persisted `candidateSha256`; a durable `committed` outcome returns immediately.
Neither recovery path launches Chromium again. `crashAfterPrepare` and
`crashAfterCommitAck` exercise both recovery seams. Only an exact `issued`
outcome may start execution. Stale, failed, indeterminate, unknown, mismatched
operation, mismatched candidate, and non-committed final outcomes fail closed
before another input read or browser launch.

The prepared candidate is the complete stored EasyDashboard project envelope.
It requires `formatVersion: 1`, `editorSchema`, and `presentation`; every
present and future envelope field is cloned unchanged, with only `editorSchema`
replaced by the Host result.

Compatibility is computed in Node from deterministic hashes of the
`agent-runtime`, Core, Dashboard Renderer, and Dashboard Agent Host `dist`
trees, plus the version and deterministic all-regular-file SHA-256 of the
emitted static browser artifact. The artifact manifest binds every relative
path to its content digest.

Before Chromium starts, the executor fetches every manifest path from the
operator-owned loopback origin with redirects disabled and compares the served
bytes to the local manifest. A missing, redirected, unreadable, or changed
response fails with `BROWSER_ARTIFACT_MISMATCH`; response bodies never enter
errors or CLI output. The browser route repeats the digest check on the exact
response it will execute: it fetches with redirects disabled, hashes the body,
and fulfills the intercepted request only with those verified bytes. A server
that changes JavaScript after a clean preflight therefore fails closed in the
primary or verification context before that changed body can reach the Host.
Browser evidence also rejects every same-origin HTTP(S) request outside the
manifest, as well as executable `blob:` or `data:` resources. Development
paths such as `/src`, `/@fs`, `/@vite`, `@react-refresh`, and
`node_modules/.vite` are forbidden.

The spike pretest rebuilds all four JavaScript artifact trees so local
source/dev verification cannot silently hash stale `dist` output. Production
must not derive provenance from a mutable workspace; deployment should inject
the compatibility tuple from immutable published packages, lock metadata, and
the published material-manifest artifact.

`seams.staleAfterObserve` and `seams.crashAfterApply` provide deterministic M0
failure seams.
