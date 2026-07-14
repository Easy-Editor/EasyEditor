import type { Document } from '../document'
import type { Project } from './project'

export interface DocumentMutationBoundary {
  allowMutations(): void
  seal(): void
  release(): void
}

type BeginDocumentMutationBoundary = (document: Document) => DocumentMutationBoundary

const boundaryOperations = new WeakMap<Project, BeginDocumentMutationBoundary>()
const activeDocuments = new WeakMap<Project, Document>()

export function installDocumentMutationBoundary(project: Project, begin: BeginDocumentMutationBoundary): void {
  if (boundaryOperations.has(project)) throw new Error('Document mutation boundary is already installed')
  boundaryOperations.set(project, begin)
}

export function beginDocumentMutationBoundary(project: Project, document: Document): DocumentMutationBoundary {
  const begin = boundaryOperations.get(project)
  if (!begin) throw new Error('Document mutation boundary is not installed')
  const boundary = begin(document)
  activeDocuments.set(project, document)
  let released = false
  return {
    allowMutations: () => boundary.allowMutations(),
    seal: () => boundary.seal(),
    release: () => {
      if (released) return
      released = true
      try {
        boundary.release()
      } finally {
        if (activeDocuments.get(project) === document) activeDocuments.delete(project)
      }
    },
  }
}

/** Package-private guard for raw compatibility writes that bypass command rollback. */
export function isDocumentMutationBoundaryActive(project: Project, document: Document): boolean {
  return activeDocuments.get(project) === document
}
