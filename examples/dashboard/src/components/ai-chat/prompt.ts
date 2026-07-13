export interface Suggestion {
  id: string
  text: string
  category: string
  description?: string
}

// 快速建议（始终显示）
export const quickSuggestions: Suggestion[] = [
  { id: '1', text: '帮我生成一个用户管理页面', category: 'quick' },
  { id: '2', text: '创建一个数据展示图表', category: 'quick' },
  { id: '3', text: '设计一个登录表单', category: 'quick' },
  { id: '4', text: '生成一个产品列表页面', category: 'quick' },
]

// 分类建议（下拉框中显示）
export const categorizedSuggestions: Record<string, Suggestion[]> = {
  页面生成: [
    { id: 'page-1', text: '用户管理页面', category: '页面生成' },
    { id: 'page-2', text: '产品管理页面', category: '页面生成' },
    { id: 'page-3', text: '订单管理页面', category: '页面生成' },
    { id: 'page-4', text: '数据统计页面', category: '页面生成' },
    { id: 'page-5', text: '设置页面', category: '页面生成' },
  ],
  组件配置: [
    { id: 'comp-1', text: '添加一个按钮组件', category: '组件配置' },
    { id: 'comp-2', text: '配置表格组件', category: '组件配置' },
    { id: 'comp-3', text: '设置图片组件', category: '组件配置' },
    { id: 'comp-4', text: '添加文本组件', category: '组件配置' },
  ],
  数据展示: [
    { id: 'data-1', text: '创建柱状图', category: '数据展示' },
    { id: 'data-2', text: '生成饼图', category: '数据展示' },
    { id: 'data-3', text: '设计折线图', category: '数据展示' },
    { id: 'data-4', text: '配置数据表格', category: '数据展示' },
  ],
  表单设计: [
    { id: 'form-1', text: '登录表单', category: '表单设计' },
    { id: 'form-2', text: '注册表单', category: '表单设计' },
    { id: 'form-3', text: '用户信息表单', category: '表单设计' },
    { id: 'form-4', text: '搜索表单', category: '表单设计' },
  ],
}
