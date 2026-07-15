import { merge } from 'lodash-es'
import {
  type IDataSourceRuntimeContext,
  type IRuntimeDataSource,
  type RequestHandler,
  type RuntimeDataSourceConfig,
  RuntimeDataSourceStatus,
  type RuntimeOptionsConfig,
  type UrlParamsHandler,
} from '../types'

class RuntimeDataSourceItem<TParams extends Record<string, unknown> = Record<string, unknown>, TResultData = unknown>
  implements IRuntimeDataSource<TParams, TResultData>
{
  private _data?: TResultData

  private _error?: Error

  private _status = RuntimeDataSourceStatus.Initial

  private _dataSourceConfig: RuntimeDataSourceConfig

  private _request: RequestHandler<{ data: TResultData }> | UrlParamsHandler<TResultData>

  private _context: IDataSourceRuntimeContext

  private _options?: RuntimeOptionsConfig

  constructor(
    dataSourceConfig: RuntimeDataSourceConfig,
    request: RequestHandler<{ data: TResultData }> | UrlParamsHandler<TResultData>,
    context: IDataSourceRuntimeContext,
  ) {
    this._dataSourceConfig = dataSourceConfig
    this._request = request
    this._context = context
  }

  get data() {
    return this._data
  }

  get error() {
    return this._error
  }

  get status() {
    return this._status
  }

  get isLoading() {
    return this._status === RuntimeDataSourceStatus.Loading
  }

  async load(params?: TParams) {
    if (!this._dataSourceConfig) return
    this._error = undefined
    this._status = RuntimeDataSourceStatus.Loading

    try {
      // 考虑没有绑定对应的 handler 的情况
      if (!this._request) {
        throw new Error(`no ${this._dataSourceConfig.type} handler provide`)
      }

      // TODO: urlParams  有没有更好的处理方式
      if (this._dataSourceConfig.type === 'urlParams') {
        const response = await (this._request as UrlParamsHandler<TResultData>)(this._context)
        this._context.setState({
          [this._dataSourceConfig.id]: response,
        })

        this._data = response
        this._status = RuntimeDataSourceStatus.Loaded
        return response
      }

      if (!this._dataSourceConfig.options) {
        throw new Error(`${this._dataSourceConfig.id} has no options`)
      }

      if (typeof this._dataSourceConfig.options === 'function') {
        this._options = this._dataSourceConfig.options()
      }

      // 考虑转换之后是 null 的场景
      if (!this._options) {
        throw new Error(`${this._dataSourceConfig.id} options transform error`)
      }

      // 临时变量存，每次可能结果不一致，不做缓存
      let shouldFetch = true
      let fetchOptions = this._options

      // 如果load存在参数则采取合并的策略合并参数，合并后再一起参与shouldFetch，willFetch的计算
      if (params) {
        fetchOptions.params = merge(fetchOptions.params, params)
      }

      if (this._dataSourceConfig.shouldFetch) {
        if (typeof this._dataSourceConfig.shouldFetch === 'function') {
          shouldFetch = this._dataSourceConfig.shouldFetch(fetchOptions)
        } else if (typeof this._dataSourceConfig.shouldFetch === 'boolean') {
          shouldFetch = this._dataSourceConfig.shouldFetch
        }
      }

      if (!shouldFetch) {
        this._status = RuntimeDataSourceStatus.Error
        this._error = new Error(`the ${this._dataSourceConfig.id} request should not fetch, please check the condition`)
        console.warn(this.error)
        return
      }

      // willFetch, 参数为当前options，如果load有参数，则会合并到options中的params中
      if (this._dataSourceConfig.willFetch) {
        fetchOptions = await this._dataSourceConfig.willFetch(this._options)
      }

      const dataHandler = this._dataSourceConfig.dataHandler!
      const { errorHandler } = this._dataSourceConfig

      // _context 会给传，但是用不用由 handler 说了算
      const result = await (
        this._request as RequestHandler<{
          data: TResultData
        }>
      )(fetchOptions, this._context).then(dataHandler, errorHandler)

      // 结果赋值
      this._data = result
      this._status = RuntimeDataSourceStatus.Loaded

      // setState
      this._context.setState({
        UNSTABLE_dataSourceUpdatedAt: Date.now(),
        [this._dataSourceConfig.id]: result,
      })

      return this._data
    } catch (error) {
      this._error = error as Error
      this._status = RuntimeDataSourceStatus.Error

      // setState
      this._context.setState({
        UNSTABLE_dataSourceUpdatedAt: Date.now(),
        [`UNSTABLE_${this._dataSourceConfig.id}_error`]: error,
      })

      throw error
    }
  }
}

export { RuntimeDataSourceItem }
