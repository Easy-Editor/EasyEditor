# Document Executor M0 results

Measured on 2026-07-31 with macOS 26.5.2 arm64, Node 22.23.2, and Chrome
for Testing 149.0.7827.55 (Playwright Chromium build 1228). These numbers are
local spike evidence, not a production latency or capacity SLA.

## Gate result

- One isolated Node CLI completed the real Hono `issue -> outcome -> input ->
  prepared -> commit -> outcome` flow against a fresh PostgreSQL database.
- The executor launched one fresh Chromium and two fresh contexts per
  operation. The second context reloaded the serialized candidate, applied one
  more semantic edit, and proved Core undo.
- Five fresh executions of the same exact prepare input produced identical
  candidate schema, byte count, and SHA-256.
- The cross-repository test committed exactly one draft version and one
  revision; repeated commit and outcome reads returned byte-identical results.
- Neither browser context contained cookies, local storage, session storage,
  IndexedDB, or Cache Storage before Harness execution. After an explicit real
  persistence flush, both contexts matched the exact local-storage and
  IndexedDB closure: one migration, one generation-2 autosave draft equal to
  that context's current candidate, candidate-derived provenance, no records
  in other stores, and empty session/Cache Storage. No cleanup was used.
- Recursive negative tests rejected unrelated local-storage keys, credential
  values, an unexpected database, a credential-bearing Dashboard DB record,
  hidden mutation/recovery grants, and every exact database-credential key in
  the Hono executor contract. The same checks cover both contexts and CLI-safe
  failure output.
- The executor now requires the runtime `VITE_E2E=1` Harness marker before
  either Host call, and any attempted `/api` or cross-origin request fails the
  operation.
- The Harness is now a dedicated static bundle served with `vite preview`.
  Before Chromium starts, every emitted regular file is fetched from loopback
  and compared byte-for-byte with its path digest. A tampered JavaScript server
  fails with `BROWSER_ARTIFACT_MISMATCH` before Host creation.
- Each browser request for a manifest artifact is independently fetched with
  redirects disabled, hashed, and fulfilled from the verified bytes. Stateful
  server tests prove that JavaScript changed after a clean preflight is rejected
  in both the primary and verification contexts without leaking the body or
  grant through direct or CLI errors.
- Browser request evidence contains no Vite development paths and rejects
  same-origin HTTP(S) resources outside the immutable manifest.

## Immutable browser artifact gate

The compatibility contract now adds strict `browserArtifactVersion` and
`browserArtifactSha256` fields while preserving the four package version/hash
pairs and material-manifest binding. The browser digest covers every regular
file in `.browser-dist`, including path and bytes, and the per-path digest
manifest is verified against the operator loopback server.

The preflight is not treated as lasting authority. The browser interception
gate binds execution to the response bytes checked at request time, closing the
preflight-to-navigation race for both contexts.

Two consecutive static builds produced the same browser artifact SHA-256:
`eb98db31804dbe662a74e524bdc83cbcad89f0957bb887bc9306da0f528e3ce2`.

## Local resource sample

Two identical operations ran sequentially in one Node process against the
static bundle served by `vite preview`. `/usr/bin/time -l` reported a
command-level maximum resident set size of 226,951,168 bytes (about 216 MiB).

| Metric | First operation | Warm operation |
| --- | ---: | ---: |
| Total executor time | 831.45 ms | 623.01 ms |
| Host startup | 6.20 ms | 6.10 ms |
| `screen.applyChangeSet` | 16.60 ms | 16.20 ms |
| Project export | 0.10 ms | 0.20 ms |
| Node RSS delta | 32,407,552 bytes | 13,074,432 bytes |
| Chromium launches | 1 | 1 |
| Browser contexts | 2 | 2 |
| Request failures | 0 | 0 |
| Render resource errors | 0 | 0 |

Both operations produced the same 995-byte candidate with SHA-256
`39d914c51363037ba2b2c82ae93f563b9acfb95ede84d60d3b072d2496edf374`.

The M0 stage uses no model calls or provider tokens. Its variable
infrastructure unit is one Node executor process, one Chromium launch, two
browser contexts, six Hono requests including issuance, and the corresponding
PostgreSQL issue/prepare/CAS ledger work. A currency amount is intentionally
not claimed until the production Worker/Executor deployment SKU, concurrency,
and billing region are selected.

## Local immutable artifact snapshot

This tuple records the rebuilt package `dist` trees, static browser artifact,
and material binding used by the final local M0 verification. It is not a
production release manifest and must not be hand-copied into deployment
configuration.

```json
{
  "runtimeVersion": "0.0.0",
  "runtimeSha256": "a5bf842a2d29767751be7bc95ff3ef84b402122bb68f527c20511fa87eda8121",
  "coreVersion": "1.0.3",
  "coreSha256": "81f2260b9a990110a3c3bded15da8d485a07ce6d702523bc2d0f710a7f224d79",
  "rendererVersion": "1.0.4",
  "rendererSha256": "0b9210be4c51b8172aaeea89afcf891dd8e3397e5a7fed4b23d4e5a6aee85b49",
  "dashboardAgentHostVersion": "0.0.0",
  "dashboardAgentHostSha256": "cc70d2a363cc1c7977ac1efada773280d123c98ade83c479816bd92eac54e66a",
  "browserArtifactVersion": "0.0.0",
  "browserArtifactSha256": "eb98db31804dbe662a74e524bdc83cbcad89f0957bb887bc9306da0f528e3ce2",
  "materialManifestVersion": "12",
  "materialManifestSha256": "4759655f46014ecf61962ee15a6a4a2a18392b455f72c7e6236a80ec0f8070d5"
}
```

## Deliberate M0 limits

- The Harness runs the real local registry and renderer with `VITE_E2E=1` so
  the existing editor does not bootstrap optional third-party CDN metadata or
  setters.
- Browser requests are restricted to the operator-owned loopback Harness
  origin. Every same-origin HTTP(S) path must exist in the verified manifest;
  `/api`, cross-origin requests, and executable `blob:` or `data:` resources
  are blocked, and any attempted forbidden request fails the operation.
- Remote materials, fonts, images, generated components, and authenticated app
  origins therefore remain outside the passing M0 contract. Production must
  admit immutable artifacts by digest and serve them from an executor-owned
  origin before this restriction can be widened.
- The Host and runtime were built, packed twice with byte-identical archives,
  and imported through their packed public entries. The local archive hashes
  were `c6ae7e3ae754e08141585a724fcfc55273e8023d1c6b027662216d7c6d12c7ff`
  for Dashboard Host and
  `2dedb4094d28e3be9a4d91ba8375f41af4f26083c6cf3ffd62e8a0ce5f492260`
  for Agent Runtime. No public prerelease was published.
