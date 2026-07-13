import type { Document } from './document'

interface DocumentTeardownOperations {
  purge(): void
  remove(): void
  retire(): void
}

const teardownOperations = new WeakMap<Document, DocumentTeardownOperations>()

/** @internal Install non-public document cleanup authority. */
export function installDocumentTeardown(document: Document, operations: DocumentTeardownOperations): void {
  if (teardownOperations.has(document)) throw new Error('Document teardown authority is already installed')
  teardownOperations.set(document, operations)
}

/** @internal Remove a document without publishing material usage notifications. */
export function removeDocumentDuringTeardown(document: Document): void {
  const operations = teardownOperations.get(document)
  if (!operations) throw new Error('Document teardown authority is not installed')
  operations.remove()
}

/** @internal Best-effort fallback after an interrupted teardown removal. */
export function purgeDocumentDuringTeardown(document: Document): void {
  const operations = teardownOperations.get(document)
  if (!operations) throw new Error('Document teardown authority is not installed')
  operations.purge()
}

/** @internal Permanently revoke a document after its project identity is detached. */
export function retireDocumentDuringTeardown(document: Document): void {
  const operations = teardownOperations.get(document)
  if (!operations) throw new Error('Document teardown authority is not installed')
  operations.retire()
}
