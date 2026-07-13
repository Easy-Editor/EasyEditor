import {
  type AgentAuditRecord,
  type AgentCapability,
  type AgentExecutionReceipt,
  type AgentPlanPreview,
  type EditorCommand,
  type EngineInstance,
  PolicyViolation,
  SchemaValidationError,
  createEngine,
  defaultEngine,
} from '../src/index.js'

const engine: EngineInstance = createEngine()
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
void receipt
void auditRecords
void defaultEngine
void PolicyViolation
void SchemaValidationError
