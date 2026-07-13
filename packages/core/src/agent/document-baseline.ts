import type { Document } from '../document'
import { uniqueId } from '../utils/unique-id'
import { prepareAgentSnapshotData } from './strict-data-validator'

interface TrackedDocument {
  epoch: number
  mutationVersion: number
  observedSerialized: string
  revision: string
}

export interface AgentDocumentBaseline {
  readonly document: Document
  readonly epoch: number
  readonly revision: string
  readonly schema: ReturnType<Document['export']>
  readonly serialized: string
  readonly bytes: number
}

/**
 * Produces opaque revisions from the document's monotonic write clock plus its
 * serialized state. Weak keys ensure a closed capability cannot keep a removed
 * document alive through the baseline registry.
 */
export class AgentDocumentBaselineRegistry {
  private tracked = new WeakMap<Document, TrackedDocument>()

  capture(document: Document, maxBytes = 2 * 1024 * 1024): AgentDocumentBaseline {
    const prepared = prepareAgentSnapshotData(document.exportRaw(), '$.schema', {
      limitCode: 'agent.limit.snapshotBytes',
      limitMessage: `Document snapshot exceeds limit ${maxBytes}`,
      maxBytes,
      maxDepth: 256,
      maxNodes: Math.min(262_144, maxBytes),
    })
    let state = this.tracked.get(document)
    if (!state) {
      state = {
        epoch: 0,
        mutationVersion: document.mutationVersion,
        observedSerialized: prepared.serialized,
        revision: uniqueId('revision'),
      }
      this.tracked.set(document, state)
    } else if (state.mutationVersion !== document.mutationVersion || state.observedSerialized !== prepared.serialized) {
      state.epoch += 1
      state.mutationVersion = document.mutationVersion
      state.observedSerialized = prepared.serialized
      state.revision = uniqueId('revision')
    }

    return {
      bytes: prepared.bytes,
      document,
      epoch: state.epoch,
      revision: state.revision,
      schema: prepared.value,
      serialized: prepared.serialized,
    }
  }

  clear(): void {
    this.tracked = new WeakMap()
  }
}
