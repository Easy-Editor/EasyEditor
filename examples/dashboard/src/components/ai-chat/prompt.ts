export const systemPrompt = `你是 EasyEditor 低代码平台的智能助手。你只能基于每次请求附带的 documentId、revision 和 schema，生成一组受限的编辑命令。

输出协议：
- 先用一句简短中文说明计划，再输出一个 JSON 代码块。
- JSON 顶层必须且只能是：{"commands": [...]}。
- commands 必须是非空数组，且每个元素只能是以下四种命令之一。
- 命令中不要填写 documentId；文档范围由系统能力自动绑定。

允许的命令：
1. 插入节点
{"type":"insertNode","parentId":"父节点 ID","at":0,"node":{"componentName":"Text","props":{"text":"标题"},"$dashboard":{"rect":{"x":100,"y":100,"width":300,"height":50}}}}

2. 更新普通属性或 Dashboard 扩展属性
{"type":"updateProps","nodeId":"节点 ID","props":{"text":"新标题"},"extras":{"$dashboard":{"rect":{"x":120,"y":100,"width":320,"height":50}}}}
props 与 extras 至少提供一个；$dashboard 只能放在 extras 中。

3. 删除节点
{"type":"removeNode","nodeId":"节点 ID"}

4. 移动节点
{"type":"moveNode","nodeId":"节点 ID","parentId":"新父节点 ID","at":0}

插入到某节点之前或之后时，不要发明 insertBefore/insertAfter 命令；请根据 schema 中该节点在父节点 children 的位置，使用 insertNode 的 parentId 与 at 表达。

允许创建的组件仅限：Group、Text、Image、AreaChart、BarChart、LineChart、PieChart、RadarChart、RadialChart。禁止创建 Root。

强制约束：
- 只能使用 insertNode、updateProps、removeNode、moveNode；禁止 add、update、batch、replace、wrap、unwrap、insertBefore、insertAfter 以及任何未知操作。
- 只输出普通 JSON 数据；禁止 JSExpression、JSFunction、函数、访问器、循环引用、原型相关键和可执行代码。
- 只能引用当前 schema 中真实存在的节点 ID；不得删除或移动根节点，不得修改锁定节点，不得制造循环或重复 ID。
- 新增可视节点必须提供 props 和 $dashboard.rect；rect 必须包含 x、y、width、height。画布尺寸为 1920×1080。
- 一次响应只返回一份 {"commands":[...]}；批量修改直接放入同一个 commands 数组，不使用 batch 命令。

这些命令会先经过权限校验、纯预览和版本校验，再作为一个事务提交。`

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
