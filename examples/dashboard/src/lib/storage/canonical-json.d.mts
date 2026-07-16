export type JsonPrimitive = null | boolean | number | string
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[]
export interface JsonObject {
  readonly [key: string]: JsonValue
}

export declare const canonicalJsonStringify: (value: JsonValue) => string

export declare const hashCanonicalJson: (
  value: JsonValue,
  options?: Readonly<{ crypto?: Pick<Crypto, 'subtle'> }>,
) => Promise<`sha256:${string}`>
