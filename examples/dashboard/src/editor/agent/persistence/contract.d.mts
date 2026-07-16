export declare const PERSISTENCE_LINEAGE_SCHEMA_VERSION: 1

export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }
export type JsonObject = { readonly [key: string]: JsonValue }

export declare class PersistenceLineageContractError extends TypeError {
  readonly code: 'INVALID_LINEAGE_DTO'
  readonly reason: string
  readonly path: string
  constructor(reason: string, path?: string)
  toJSON(): {
    readonly schemaVersion: 1
    readonly code: 'INVALID_LINEAGE_DTO'
    readonly reason: string
    readonly path: string
  }
}

export declare const failContract: (reason: string, path?: string) => never
export declare const ownDataValue: (value: unknown, key: PropertyKey, path: string) => unknown
export declare const optionalOwnDataValue: (value: unknown, key: PropertyKey, path: string) => unknown
export declare const assertExactRecord: (
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  path: string,
) => object
export declare const compareCodeUnits: (left: string, right: string) => -1 | 0 | 1
export declare const requireSchemaVersion: (value: unknown, path: string) => 1
export declare const requireNonEmptyString: (value: unknown, path: string) => string
export declare const requireNonNegativeInteger: (value: unknown, path: string) => number
export declare const requireSha256: (value: unknown, path: string) => `sha256:${string}`
export declare const requireLiteral: <const TAllowed extends readonly JsonPrimitive[]>(
  value: unknown,
  allowed: TAllowed,
  path: string,
) => TAllowed[number]
export declare const cloneJsonValue: (value: unknown, path?: string) => JsonValue
export declare const cloneJsonObject: (value: unknown, path?: string) => JsonObject
export declare const canonicalJsonString: (value: unknown) => string
export declare const jsonDataEqual: (left: unknown, right: unknown) => boolean
export declare const freezeDto: <T>(value: T) => Readonly<T>
