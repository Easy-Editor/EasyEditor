export declare class AgentRequestSlot {
  begin(): AbortController | undefined
  cancel(): void
  release(controller: AbortController): boolean
}
