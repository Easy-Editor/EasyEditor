/**
 * Remote Load Errors
 * 远程资源加载统一错误定义
 */

/** 远程资源加载错误类型 */
export enum RemoteLoadErrorType {
  /** 网络错误 */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** 包不存在 */
  PACKAGE_NOT_FOUND = 'PACKAGE_NOT_FOUND',
  /** 版本不存在 */
  VERSION_NOT_FOUND = 'VERSION_NOT_FOUND',
  /** 脚本加载失败 */
  SCRIPT_LOAD_FAILED = 'SCRIPT_LOAD_FAILED',
  /** CSS 加载失败 */
  CSS_LOAD_FAILED = 'CSS_LOAD_FAILED',
  /** 全局变量未找到 */
  GLOBAL_NOT_FOUND = 'GLOBAL_NOT_FOUND',
  /** 元数据格式无效 */
  METADATA_INVALID = 'METADATA_INVALID',
  /** 所有 CDN 都失败 */
  CDN_ALL_FAILED = 'CDN_ALL_FAILED',
  /** 加载超时 */
  TIMEOUT = 'TIMEOUT',
}

/** 资源类型 */
export type ResourceType = 'material' | 'setter'

/** 错误消息映射 */
const ERROR_MESSAGES: Record<RemoteLoadErrorType, (resourceName: string, resourceType: ResourceType) => string> = {
  [RemoteLoadErrorType.NETWORK_ERROR]: () => '网络连接失败，请检查您的网络设置',
  [RemoteLoadErrorType.PACKAGE_NOT_FOUND]: (name, type) =>
    `${type === 'material' ? '物料包' : '设置器包'} "${name}" 不存在`,
  [RemoteLoadErrorType.VERSION_NOT_FOUND]: () => '指定的版本不存在',
  [RemoteLoadErrorType.SCRIPT_LOAD_FAILED]: (_, type) => `${type === 'material' ? '物料' : '设置器'}脚本加载失败`,
  [RemoteLoadErrorType.CSS_LOAD_FAILED]: () => '样式加载失败',
  [RemoteLoadErrorType.GLOBAL_NOT_FOUND]: (_, type) => `${type === 'material' ? '物料' : '设置器'}格式不正确`,
  [RemoteLoadErrorType.METADATA_INVALID]: () => '元数据格式错误',
  [RemoteLoadErrorType.CDN_ALL_FAILED]: () => '所有 CDN 加载失败',
  [RemoteLoadErrorType.TIMEOUT]: () => '加载超时',
}

/**
 * 远程资源加载错误
 */
export class RemoteLoadError extends Error {
  readonly name = 'RemoteLoadError'

  constructor(
    /** 错误类型 */
    public readonly type: RemoteLoadErrorType,
    /** 资源名称（包名或全局变量名） */
    public readonly resourceName: string,
    /** 资源类型 */
    public readonly resourceType: ResourceType,
    /** 错误消息 */
    message: string,
    /** 原始错误 */
    public readonly originalError?: unknown,
  ) {
    super(message)

    // 确保原型链正确
    Object.setPrototypeOf(this, RemoteLoadError.prototype)
  }

  /**
   * 获取用户友好的错误消息
   */
  toUserMessage(): string {
    const getMessage = ERROR_MESSAGES[this.type]
    return getMessage?.(this.resourceName, this.resourceType) || `加载失败: ${this.message}`
  }

  /**
   * 创建错误实例的便捷方法
   */
  static create(
    type: RemoteLoadErrorType,
    resourceName: string,
    resourceType: ResourceType,
    message?: string,
    originalError?: unknown,
  ): RemoteLoadError {
    const defaultMessage = ERROR_MESSAGES[type]?.(resourceName, resourceType) || type
    return new RemoteLoadError(type, resourceName, resourceType, message || defaultMessage, originalError)
  }
}
