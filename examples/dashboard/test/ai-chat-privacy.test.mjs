import assert from 'node:assert/strict'
import test from 'node:test'

import { filterMessageContent, parseAiCommands } from '../src/components/ai-chat/commands.mjs'
import {
  MAX_CHAT_MESSAGES,
  createCanvasProjection,
  createChatRequest,
  resolveCommandAliases,
} from '../src/components/ai-chat/privacy.mjs'

const SECRET_SENTINELS = [
  'document-secret-id',
  'revision-secret-value',
  'raw-root-id',
  'raw-child-id',
  'https://private.example.test/data',
  'sk-private-token',
  'executable-method-sentinel',
  'lifecycle-sentinel',
  'datasource-sentinel',
  'state-sentinel',
  'css-sentinel',
  'unknown-prop-sentinel',
]

const privateSchema = {
  documentId: 'document-secret-id',
  revision: 'revision-secret-value',
  id: 'raw-root-id',
  componentName: 'Root',
  methods: { load: 'executable-method-sentinel' },
  lifeCycles: { mounted: 'lifecycle-sentinel' },
  dataSource: { url: 'datasource-sentinel' },
  state: { session: 'state-sentinel' },
  css: '.private { content: "css-sentinel" }',
  props: {
    title: '公开标题',
    endpoint: 'https://private.example.test/data',
    accessToken: 'sk-private-token',
    unknown: 'unknown-prop-sentinel',
  },
  $dashboard: {
    rect: { x: 12, y: 24, width: 640, height: 480 },
  },
  children: [
    {
      id: 'raw-child-id',
      componentName: 'Text',
      locked: true,
      props: {
        text: '允许发送的画布文案',
        href: 'https://private.example.test/data',
      },
      children: [],
    },
  ],
}

test('canvas projection exposes request-local aliases and only allowlisted presentation data', () => {
  const first = createCanvasProjection(privateSchema, { nonce: 'first' })
  const second = createCanvasProjection(privateSchema, { nonce: 'second' })
  const serialized = JSON.stringify(first.canvas)

  for (const sentinel of SECRET_SENTINELS) {
    assert.equal(serialized.includes(sentinel), false, `projection leaked ${sentinel}`)
  }

  assert.match(serialized, /公开标题/)
  assert.match(serialized, /允许发送的画布文案/)
  assert.equal(first.canvas.nodes.length, 2)
  assert.notEqual(first.canvas.nodes[0].alias, second.canvas.nodes[0].alias)
  assert.equal(first.nodeIdsByAlias.get(first.canvas.nodes[0].alias), 'raw-root-id')
  assert.equal(first.nodeIdsByAlias.get(first.canvas.nodes[1].alias), 'raw-child-id')
  assert.equal(Object.hasOwn(first.canvas.nodes[0], 'id'), false)
  assert.deepEqual(first.canvas.nodes[0].rect, { x: 12, y: 24, width: 640, height: 480 })
})

test('chat request removes system messages and bounds history and byte size', () => {
  const { canvas } = createCanvasProjection(privateSchema, { nonce: 'bounded' })
  const messages = [
    { role: 'system', content: 'browser-controlled-system-prompt' },
    ...Array.from({ length: MAX_CHAT_MESSAGES + 8 }, (_, index) => ({
      role: index % 2 === 0 ? 'assistant' : 'user',
      content: `${index}-${'长'.repeat(4_000)}`,
    })),
    { role: 'user', content: '最终用户请求' },
  ]

  const request = createChatRequest(messages, canvas)
  const serialized = JSON.stringify(request)

  assert.ok(request.messages.length <= MAX_CHAT_MESSAGES)
  assert.equal(request.messages.at(-1)?.content, '最终用户请求')
  assert.equal(
    request.messages.some(message => message.role === 'system'),
    false,
  )
  assert.equal(serialized.includes('browser-controlled-system-prompt'), false)
  assert.ok(Buffer.byteLength(serialized) <= 48 * 1024)
})

test('command aliases resolve only through the private map for that request', () => {
  const aliases = new Map([
    ['n_request_1', 'raw-root-id'],
    ['n_request_2', 'raw-child-id'],
  ])
  assert.deepEqual(
    resolveCommandAliases(
      [
        { type: 'updateProps', nodeId: 'n_request_2', props: { text: '更新' } },
        { type: 'moveNode', nodeId: 'n_request_2', parentId: 'n_request_1', at: 0 },
      ],
      aliases,
    ),
    [
      { type: 'updateProps', nodeId: 'raw-child-id', props: { text: '更新' } },
      { type: 'moveNode', nodeId: 'raw-child-id', parentId: 'raw-root-id', at: 0 },
    ],
  )
  assert.throws(
    () => resolveCommandAliases([{ type: 'removeNode', nodeId: 'raw-child-id' }], aliases),
    /must reference a node alias from this request/,
  )
})

test('worker command parser accepts one strict envelope and rejects ambient authority fields', () => {
  assert.deepEqual(parseAiCommands('说明\n```json\n{"commands":[{"type":"removeNode","nodeId":"n_request_2"}]}\n```'), [
    { type: 'removeNode', nodeId: 'n_request_2' },
  ])

  assert.throws(
    () => parseAiCommands('{"commands":[{"type":"removeNode","nodeId":"n_request_2","documentId":"secret"}]}'),
    /不允许指定 documentId/,
  )
  assert.throws(() => parseAiCommands('{"commands":[{"type":"prototypeMutation"}]}'), /未知操作/)
  assert.throws(() => parseAiCommands('{"commands":[],"systemPrompt":"attacker"}'), /只允许包含 commands/)
  assert.throws(
    () =>
      parseAiCommands(
        '{"commands":[{"type":"removeNode","nodeId":"n_request_2"}]}\n{"commands":[{"type":"removeNode","nodeId":"n_request_3"}]}',
      ),
    /只能包含一个 JSON 指令块/,
  )
})

test('worker removes the complete command envelope before returning assistant text to the UI', () => {
  assert.equal(
    filterMessageContent('已完成。\n```json\n{"commands":[{"type":"removeNode","nodeId":"n_request_2"}]}\n```'),
    '已完成。',
  )
  assert.equal(filterMessageContent('已完成 {"commands":[{"type":"removeNode","nodeId":"n_request_2"}]}'), '已完成')
  assert.equal(
    filterMessageContent(
      '已更新 n_request_2。 {"commands":[{"type":"removeNode","nodeId":"n_request_2"}]} 冗余 {"commands":[{"type":"removeNode","nodeId":"n_request_3"}]}',
      ['n_request_2', 'n_request_3'],
    ),
    '已更新 节点。  冗余',
  )
})
