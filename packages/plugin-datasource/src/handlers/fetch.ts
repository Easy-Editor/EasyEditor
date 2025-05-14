import request from 'universal-request'
import type { AsObject, RequestOptions } from 'universal-request/lib/types'
import type { RuntimeOptionsConfig } from '../types'

// config 留着扩展
export function createFetchHandler(config?: Record<string, unknown>) {
  return async (options: RuntimeOptionsConfig) => {
    const requestConfig: RequestOptions = {
      ...options,
      url: options.uri,
      method: options.method as RequestOptions['method'],
      data: options.params as AsObject,
      headers: options.headers as AsObject,
      ...config,
    }
    const response = await request(requestConfig)
    return response
  }
}
