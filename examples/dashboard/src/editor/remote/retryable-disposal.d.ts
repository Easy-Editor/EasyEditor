export interface DisposalStep {
  readonly name: string
  readonly run: () => void | Promise<void>
}

export declare class RetryableDisposal {
  constructor(steps: readonly DisposalStep[])
  dispose(): Promise<void>
}
