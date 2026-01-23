/**
 * Rollup Constants
 * Rollup 相关常量和工具函数
 */

/**
 * 默认的文件扩展名
 */
export const DEFAULT_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx']

/**
 * 首字母大写
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * 转换为 PascalCase
 */
export function toPascalCase(str: string): string {
  return str
    .split('-')
    .map(part => capitalize(part))
    .join('')
}
