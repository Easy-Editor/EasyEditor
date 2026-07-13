import { type AgentCapability, type AgentDocumentSnapshot, defaultEngine } from '@easy-editor/core'

const DASHBOARD_AGENT_COMPONENT_NAMES = [
  'AreaChart',
  'BarChart',
  'Group',
  'Image',
  'LineChart',
  'PieChart',
  'RadarChart',
  'RadialChart',
  'Text',
] as const

export interface DashboardAgentContext {
  readonly capability: AgentCapability
  readonly snapshot: AgentDocumentSnapshot
}

/**
 * Trusted Dashboard composition root for a single AI request.
 *
 * The chat receives only a document-scoped capability and its matching snapshot;
 * it never receives the engine, project, document, or node objects.
 */
export const createDashboardAgentContext = (): DashboardAgentContext => {
  const currentDocument = defaultEngine.project.currentDocument
  if (!currentDocument) {
    throw new Error('当前没有可编辑的文档')
  }

  const documentId = currentDocument.id
  const capability = defaultEngine.agentCapabilities.issue({
    commandTypes: ['insertNode', 'updateProps', 'removeNode', 'moveNode'],
    componentNames: DASHBOARD_AGENT_COMPONENT_NAMES,
    documentIds: [documentId],
    extraKeys: ['$dashboard'],
    limits: {
      maxCommands: 24,
      maxInsertedNodes: 120,
      maxPayloadBytes: 128 * 1024,
      maxSnapshotBytes: 1024 * 1024,
      maxTreeDepth: 48,
    },
    subjectId: 'dashboard-ai-chat',
  })

  try {
    return Object.freeze({
      capability,
      snapshot: capability.snapshot(documentId),
    })
  } catch (error) {
    capability.close()
    throw error
  }
}
