import type { Project } from '../project'
import type { Document } from './document'

interface DocumentTeardownOperations {
  clearDropLocation(): void
  purge(): void
  remove(): void
  retire(): void
}

const teardownOperations = new WeakMap<Document, DocumentTeardownOperations>()
const pendingDocumentTeardowns = new WeakMap<Project, Set<Document>>()
const projectDocumentTeardownOperations = new WeakMap<Project, (document: Document) => void>()

/** @internal Install non-public document cleanup authority. */
export function installDocumentTeardown(document: Document, operations: DocumentTeardownOperations): void {
  if (teardownOperations.has(document)) throw new Error('Document teardown authority is already installed')
  teardownOperations.set(document, operations)
}

/** @internal Install Project-owned identity unlink authority without a public class method. */
export function installProjectDocumentTeardown(project: Project, unlink: (document: Document) => void): void {
  if (projectDocumentTeardownOperations.has(project)) {
    throw new Error('Project document teardown authority is already installed')
  }
  projectDocumentTeardownOperations.set(project, unlink)
}

/** @internal Detach a terminal Document through its owning Project capability. */
export function unlinkDocumentDuringTeardown(project: Project, document: Document): void {
  const unlink = projectDocumentTeardownOperations.get(project)
  if (!unlink) throw new Error('Project document teardown authority is not installed')
  unlink(document)
}

/** @internal Clear Designer-owned drag state without reopening a retired Document. */
export function clearDocumentDropLocationDuringTeardown(document: Document): void {
  const operations = teardownOperations.get(document)
  if (!operations) throw new Error('Document teardown authority is not installed')
  operations.clearDropLocation()
}

/** @internal Remove a document without publishing material usage notifications. */
export function removeDocumentDuringTeardown(document: Document): void {
  const operations = teardownOperations.get(document)
  if (!operations) throw new Error('Document teardown authority is not installed')
  operations.remove()
}

/** @internal Permanently revoke a document after its project identity is detached. */
export function retireDocumentDuringTeardown(document: Document): void {
  const operations = teardownOperations.get(document)
  if (!operations) throw new Error('Document teardown authority is not installed')
  operations.retire()
}

/** @internal Retain failed cleanup without restoring the public Project identity. */
export function retainPendingDocumentTeardown(project: Project, document: Document): void {
  const pending = pendingDocumentTeardowns.get(project)
  if (pending) {
    pending.add(document)
    return
  }
  pendingDocumentTeardowns.set(project, new Set([document]))
}

/** @internal Forget a terminal Document only after every owned cleanup succeeds. */
export function completePendingDocumentTeardown(project: Project, document: Document): void {
  const pending = pendingDocumentTeardowns.get(project)
  if (!pending) return
  pending.delete(document)
  if (pending.size === 0) pendingDocumentTeardowns.delete(project)
}

/** @internal Snapshot retry work without exposing it through Project.documents. */
export function getPendingDocumentTeardowns(project: Project): readonly Document[] {
  return [...(pendingDocumentTeardowns.get(project) || [])]
}
