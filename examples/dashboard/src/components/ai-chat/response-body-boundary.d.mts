export declare class ResponseBodyBudgetError extends Error {
  readonly code: 'dashboard.agent.responseTooLarge'
  constructor(maxBytes: number)
}

export declare const readResponseTextWithinBudget: (response: Response, maxBytes: number) => Promise<string>
