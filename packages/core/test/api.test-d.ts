import { MessageChannel as NodeMessageChannel } from 'node:worker_threads'
import type { AgentPortSession as AgentChannelPortSession } from '../src/agent-channel.js'
import {
  type AgentAuditRecord,
  type AgentCapability,
  type AgentComponentPropPolicies,
  type AgentExecutionReceipt,
  type AgentPlanPreview,
  type AgentPortExecutionAuthority,
  type AgentPortSession,
  CURRENT_PROJECT_SCHEMA_VERSION,
  type EditorCommand,
  type EngineInstance,
  PolicyViolation,
  type SchemaPreparationResult,
  SchemaValidationError,
  SchemaValidator,
  connectAgentPort,
  createEngine,
  defaultEngine,
  resolveTrustPolicy,
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

const currentSchemaVersion: '1.0.0' = CURRENT_PROJECT_SCHEMA_VERSION
const schemaPreparation: SchemaPreparationResult = new SchemaValidator(
  resolveTrustPolicy('legacyTrusted'),
).prepareWithReport({ version: currentSchemaVersion, componentsTree: [] })
const migrated: boolean = schemaPreparation.report.migrated
void migrated

const componentProps: AgentComponentPropPolicies = {
  Text: { text: { type: 'string', maxBytes: 4096 } },
}
const capability: AgentCapability = engine.agentCapabilities.issue({
  subjectId: 'agent:type-test',
  documentIds: ['document-id'],
  commandTypes: ['insertNode', 'updateProps'],
  componentNames: ['Text'],
  componentProps,
  extraKeys: ['$dashboard'],
  extraValues: {
    $dashboard: {
      requiredOnInsert: false,
      policy: {
        type: 'object',
        properties: { layout: { type: 'string', maxBytes: 64 } },
        required: ['layout'],
        additionalProperties: false,
      },
    },
  },
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
// @ts-expect-error component property grants are deeply readonly
capability.descriptor.grant.componentProps.Text.text.maxBytes = 1024
const issuedExtraPolicy = capability.descriptor.grant.extraValues.$dashboard.policy
if (issuedExtraPolicy.type === 'object') {
  // @ts-expect-error extra value policies are deeply readonly
  issuedExtraPolicy.required.push('other')
}
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
const browserExecutionAuthority: AgentPortExecutionAuthority = browserSession.descriptor.executionAuthority
const disposeBrowserEvents = browserCapability.subscribe(event => {
  const type: 'agent.transaction.committed' = event.type
  void type
})
disposeBrowserEvents()
browserCapability.close()
browserSession.close()

const hostApprovedChannel = new MessageChannel()
const hostApprovedController = new AbortController()
const hostApprovedSession = engine.agentCapabilities.issuePort(
  {
    subjectId: 'agent:host-approved-port',
    documentIds: ['document-id'],
    commandTypes: ['updateProps'],
  },
  hostApprovedChannel.port1,
  { executionAuthority: 'host', signal: hostApprovedController.signal },
)
const hostExecutionAuthority: AgentPortExecutionAuthority = hostApprovedSession.descriptor.executionAuthority
const typedHostApprovedSession: AgentPortSession = hostApprovedSession
const channelHostApprovedSession: AgentChannelPortSession = hostApprovedSession
const hostPreparedPreview: AgentPlanPreview = typedHostApprovedSession.getPreparedPlanPreview('plan-id')
const hostApprovedReceipt: AgentExecutionReceipt = hostApprovedSession.approveAndExecute('plan-id')

engine.agentCapabilities.issuePort(
  {
    subjectId: 'agent:invalid-authority-port',
    documentIds: ['document-id'],
    commandTypes: [],
  },
  hostApprovedChannel.port1,
  {
    // @ts-expect-error execution authority is limited to peer or host
    executionAuthority: 'owner',
    signal: hostApprovedController.signal,
  },
)

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
void browserExecutionAuthority
void hostExecutionAuthority
void typedHostApprovedSession
void channelHostApprovedSession
void hostPreparedPreview
void hostApprovedReceipt
void auditRecords
void defaultEngine
void PolicyViolation
void SchemaValidationError
