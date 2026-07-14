import type { Document } from '../document'
import type { Designer } from './designer'

const clearDocumentOperations = new WeakMap<Designer, (document: Document) => void>()

/** Package-private ownership seam for clearing Designer-held document drag state. */
export function installDesignerDropLocationBoundary(
  designer: Designer,
  clearDocument: (document: Document) => void,
): void {
  if (clearDocumentOperations.has(designer)) {
    throw new Error('Designer drop-location boundary is already installed')
  }
  clearDocumentOperations.set(designer, clearDocument)
}

/** Clear only the location owned by the retiring Document, without calling its public setter. */
export function clearDesignerDropLocationDuringDocumentTeardown(designer: Designer, document: Document): void {
  const clearDocument = clearDocumentOperations.get(designer)
  if (!clearDocument) throw new Error('Designer drop-location boundary is not installed')
  clearDocument(document)
}
