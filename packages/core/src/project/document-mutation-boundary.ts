import type { Document } from '../document'
import type { Project } from './project'

export interface DocumentMutationBoundary {
  allowMutations(): void
  seal(): void
  release(): void
}

type BeginDocumentMutationBoundary = (document: Document) => DocumentMutationBoundary

const boundaryOperations = new WeakMap<Project, BeginDocumentMutationBoundary>()

export function installDocumentMutationBoundary(project: Project, begin: BeginDocumentMutationBoundary): void {
  if (boundaryOperations.has(project)) throw new Error('Document mutation boundary is already installed')
  boundaryOperations.set(project, begin)
}

export function beginDocumentMutationBoundary(project: Project, document: Document): DocumentMutationBoundary {
  const begin = boundaryOperations.get(project)
  if (!begin) throw new Error('Document mutation boundary is not installed')
  return begin(document)
}
