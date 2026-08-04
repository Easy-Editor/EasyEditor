import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DASHBOARD_AGENT_MODEL_CAPABILITY_MANIFEST,
  DASHBOARD_AGENT_MODEL_SYSTEM_MESSAGES,
  DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT,
} from '../src/agent-runtime/dashboard-model-protocol.mjs'
import {
  DASHBOARD_CAPABILITY_REGISTRY_HASH,
  DASHBOARD_CAPABILITY_REGISTRY_REVISION,
  DASHBOARD_CAPABILITY_REGISTRY_SNAPSHOT,
} from '../src/editor/agent/capabilities/registry.mjs'

const encoder = new TextEncoder()

test('publishes the exact available Dashboard capability inputs to the model', () => {
  const expectedCapabilities = DASHBOARD_CAPABILITY_REGISTRY_SNAPSHOT.capabilities
    .filter(descriptor => descriptor.availability === 'available')
    .map(({ capability, input, revision }) => ({ capability, revision, input }))

  assert.deepEqual(DASHBOARD_AGENT_MODEL_CAPABILITY_MANIFEST, {
    schemaVersion: 1,
    revision: DASHBOARD_CAPABILITY_REGISTRY_REVISION,
    hash: DASHBOARD_CAPABILITY_REGISTRY_HASH,
    capabilities: expectedCapabilities,
  })
  assert.ok(DASHBOARD_AGENT_MODEL_CAPABILITY_MANIFEST.capabilities.length > 0)
  assert.ok(
    DASHBOARD_AGENT_MODEL_CAPABILITY_MANIFEST.capabilities.some(
      descriptor => descriptor.capability === 'screen.applyChangeSet',
    ),
  )
  assert.ok(
    DASHBOARD_AGENT_MODEL_CAPABILITY_MANIFEST.capabilities.every(
      descriptor => Object.keys(descriptor).sort().join(',') === 'capability,input,revision',
    ),
  )
})

test('documents the exact EasyEditor ModelEvent and phase protocol without AG-UI ambiguity', () => {
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /EasyEditor Agent Runtime ModelEvent/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /\{"schemaVersion":1,"kind":"blueprint","summary":/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /\{"schemaVersion":1,"kind":"question","question":/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /\{"schemaVersion":1,"kind":"tool-call","call":/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /\{"schemaVersion":1,"kind":"complete"/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /\{"schemaVersion":1,"kind":"pause","reason":/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /BLUEPRINT/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /PLAN_STEP/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /REPAIR/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /request\.snapshot\.revision/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /TEXT_MESSAGE_START/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /Do not emit an AG-UI/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /Use the field kind, never type/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /Do not emit messageId/u)
  assert.match(
    DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT,
    /For request\.phase BLUEPRINT, return exactly one blueprint event, or exactly one question event, or exactly one pause event\. Never return a tool-call or complete event in BLUEPRINT\./u,
  )
  assert.match(
    DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT,
    /For request\.phase PLAN_STEP or REPAIR, return exactly one of: \[complete\], \[question\], \[pause\], \[tool-call\], or \[tool-call, complete\]\./u,
  )
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /A turn may contain at most one tool-call/u)
  assert.match(
    DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT,
    /Set call\.expectedRevision to the exact current request\.snapshot\.revision value/u,
  )
  assert.match(
    DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT,
    /Use only a capability listed in the available capability manifest/u,
  )
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /must satisfy that capability input JSON Schema exactly/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /autonomous Dashboard builder/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /materials\.writableManifests/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /at least one successful mutation/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /default generation path/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /LowAltitudeDashboard/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /Do not use artifact\.createOnline for ordinary initial/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /source at or below 12000 characters/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /"flightTrend"/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /task counts with unit 项 by default/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /percentage values must then total 100/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /preserve every existing field and section/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /complete merged object rather than a partial replacement/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /nodes\[nodeId\]\.writableValues/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /mount\(root, context\)/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /1920×1080/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /Desktop, Mobile, Visitors, Chrome, or Safari/u)
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, new RegExp(DASHBOARD_CAPABILITY_REGISTRY_REVISION, 'u'))
  assert.match(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, new RegExp(DASHBOARD_CAPABILITY_REGISTRY_HASH, 'u'))
  for (const descriptor of DASHBOARD_AGENT_MODEL_CAPABILITY_MANIFEST.capabilities) {
    assert.ok(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT.includes(JSON.stringify(descriptor)))
  }
  assert.ok(encoder.encode(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT).byteLength < 64 * 1024)
  assert.doesNotMatch(DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT, /apiKey|sessionToken|authorization/iu)
  assert.doesNotMatch(JSON.stringify(DASHBOARD_AGENT_MODEL_CAPABILITY_MANIFEST), /project\.checkpoint/u)
})

test('splits the protocol only at line boundaries accepted by the Gateway contract', () => {
  assert.ok(DASHBOARD_AGENT_MODEL_SYSTEM_MESSAGES.length >= 2)
  assert.equal(DASHBOARD_AGENT_MODEL_SYSTEM_MESSAGES.join('\n'), DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT)
  assert.ok(DASHBOARD_AGENT_MODEL_SYSTEM_MESSAGES.every(message => message.length > 0 && message.length <= 16_384))
})
