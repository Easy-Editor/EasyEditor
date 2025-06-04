import type { DataSource } from '@easy-editor/core'

declare module '@easy-editor/core' {
  interface Project {
    /**
     * 数据源配置
     */
    dataSource: DataSource | undefined
  }
}
