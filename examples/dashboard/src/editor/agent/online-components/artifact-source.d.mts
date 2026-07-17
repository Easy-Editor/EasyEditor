export interface ArtifactSourceMetadataV1 {
  readonly schemaVersion: 1
  readonly moduleFormat: 'esm-default-object'
  readonly lifecycleMethods: readonly ('destroy' | 'mount' | 'update')[]
  readonly sourceBytes: number
}

export declare const scanArtifactSource: (source: unknown) => ArtifactSourceMetadataV1
