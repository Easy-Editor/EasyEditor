import { MessageChannel as NodeMessageChannel } from 'node:worker_threads'
import {
  type AgentAuditRecord,
  type AgentCapability,
  type AgentExecutionReceipt,
  type AgentPlanPreview,
  type EditorCommand,
  type EngineInstance,
  PolicyViolation,
  SchemaValidationError,
  connectAgentPort,
  createEngine,
  defaultEngine,
} from '../src/index.js'

const engine: EngineInstance = createEngine()
engine.loadProject({ version: '0.0.1', componentsMap: [], componentsTree: [] }, true)
engine.unloadProject()
engine.undo()
engine.undo('document-id')
engine.redo(engine.project.currentDocument)
const command: EditorCommand = {
  type: 'updateProps',
  nodeId: 'node-id',
  props: { title: 'typed' },
}
const extrasOnlyCommand: EditorCommand = {
  type: 'updateProps',
  nodeId: 'node-id',
  extras: { $dashboard: { layout: 'grid' } },
}

engine.commands.execute(command)
engine.transactions.run([command])
engine.transactions.runOnDocument('document-id', [extrasOnlyCommand], document => {
  void document.id
})

const capability: AgentCapability = engine.agentCapabilities.issue({
  subjectId: 'agent:type-test',
  documentIds: ['document-id'],
  commandTypes: ['insertNode', 'updateProps'],
  componentNames: ['Text'],
  extraKeys: ['$dashboard'],
})
const snapshot = capability.snapshot('document-id')
const plan: AgentPlanPreview = capability.preview({
  documentId: snapshot.documentId,
  baseRevision: snapshot.revision,
  commands: [extrasOnlyCommand],
})
const receipt: AgentExecutionReceipt = capability.execute(plan.planId)
const auditRecords: readonly AgentAuditRecord[] = engine.agentCapabilities.getAuditRecords()
const unsubscribeAudit: () => void = engine.agentCapabilities.subscribeAudit(record => {
  const action: AgentAuditRecord['action'] = record.action
  void action
})
// @ts-expect-error issued grants are deeply readonly
capability.descriptor.grant.commandTypes.push('removeNode')
unsubscribeAudit()
capability.close()

const browserChannel = new MessageChannel()
const browserController = new AbortController()
const browserSession = engine.agentCapabilities.issuePort(
  {
    subjectId: 'agent:browser-port',
    documentIds: ['document-id'],
    commandTypes: ['updateProps'],
  },
  browserChannel.port1,
  { signal: browserController.signal },
)
const browserCapability = await connectAgentPort(browserChannel.port2)
const disposeBrowserEvents = browserCapability.subscribe(event => {
  const type: 'agent.transaction.committed' = event.type
  void type
})
disposeBrowserEvents()
browserCapability.close()
browserSession.close()

const nodeChannel = new NodeMessageChannel()
const nodeController = new AbortController()
engine.agentCapabilities.issuePort(
  {
    subjectId: 'agent:node-port',
    documentIds: ['document-id'],
    commandTypes: [],
  },
  nodeChannel.port1,
  { signal: nodeController.signal },
)
void connectAgentPort(nodeChannel.port2, {
  signal: nodeController.signal,
  connectTimeoutMs: 1000,
  requestTimeoutMs: 1000,
})
void receipt
void auditRecords
void defaultEngine
void PolicyViolation
void SchemaValidationError
