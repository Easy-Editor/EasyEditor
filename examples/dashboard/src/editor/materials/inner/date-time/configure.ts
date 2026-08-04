import type { Configure, Node } from '@easy-editor/core'
import { updateNodeRect } from '@easy-editor/plugin-dashboard'
import DateTime from './component'

const propAgentCapability = (name: string, valueSchema: Record<string, unknown>) => ({
  access: 'read-write',
  fieldId: `dateTime.${name}`,
  readPath: ['props', name],
  writeTargets: [{ path: ['props', name] }],
  unsetTargets: [{ path: ['props', name] }],
  valueSchema,
  verifyPaths: [['props', name]],
})

const titleAgentCapability = {
  access: 'read-write',
  fieldId: 'shared.title',
  readPath: ['extra', 'title'],
  writeTargets: [{ path: ['extra', 'title'] }],
  unsetTargets: [{ path: ['extra', 'title'] }],
  valueSchema: { type: 'string' },
  verifyPaths: [['extra', 'title']],
}

const rectAgentCapability = {
  access: 'read-write',
  fieldId: 'shared.rect',
  readPath: ['extra', '$dashboard', 'rect'],
  writeTargets: [{ path: ['extra', '$dashboard', 'rect'] }],
  unsetTargets: [{ path: ['extra', '$dashboard', 'rect'] }],
  valueSchema: {
    type: 'object',
    required: ['x', 'y', 'width', 'height'],
    properties: {
      x: { type: 'number' },
      y: { type: 'number' },
      width: { type: 'number', minimum: 0 },
      height: { type: 'number', minimum: 0 },
    },
  },
  verifyPaths: [['extra', '$dashboard', 'rect']],
}

const visibilityAgentCapability = {
  access: 'read-write',
  fieldId: 'shared.visibility',
  readPath: ['extra', 'condition'],
  writeTargets: [{ path: ['extra', 'condition'] }],
  unsetTargets: [{ path: ['extra', 'condition'] }],
  valueSchema: { type: 'boolean' },
  verifyPaths: [['extra', 'condition']],
}

const selectSetter = (options: Array<{ label: string; value: string }>) => ({
  componentName: 'SelectSetter',
  props: { options },
})

const configure: Configure = {
  props: [
    {
      type: 'group',
      title: '功能',
      setter: 'TabSetter',
      items: [
        {
          type: 'group',
          key: 'basic',
          title: '配置',
          items: [
            {
              name: 'nodeInfo',
              title: '节点信息',
              setter: 'NodeInfoSetter',
              extraProps: { agent: { expose: false }, label: false } as any,
            },
            {
              name: 'title',
              title: '标题',
              setter: 'StringSetter',
              extraProps: {
                agent: titleAgentCapability,
                getValue(target: any) {
                  return target.getExtraPropValue('title')
                },
                setValue(target: any, value: string) {
                  target.setExtraPropValue('title', value)
                },
              } as any,
            },
            {
              name: 'mode',
              title: '显示内容',
              setter: selectSetter([
                { label: '日期', value: 'date' },
                { label: '时间', value: 'time' },
                { label: '日期与时间', value: 'datetime' },
              ]),
              extraProps: {
                agent: propAgentCapability('mode', { enum: ['date', 'time', 'datetime'], type: 'string' }),
                defaultValue: 'datetime',
              } as any,
            },
            {
              name: 'locale',
              title: '区域格式',
              setter: selectSetter([
                { label: '中文', value: 'zh-CN' },
                { label: '英文', value: 'en-US' },
              ]),
              extraProps: {
                agent: propAgentCapability('locale', { enum: ['zh-CN', 'en-US'], type: 'string' }),
                defaultValue: 'zh-CN',
              } as any,
            },
            {
              name: 'dateFormat',
              title: '日期分隔格式',
              setter: selectSetter([
                { label: '本地化', value: 'localized' },
                { label: '点分隔 2026.08.02', value: 'dot' },
                { label: '短横线 2026-08-02', value: 'dash' },
                { label: '斜线 2026/08/02', value: 'slash' },
              ]),
              extraProps: {
                agent: propAgentCapability('dateFormat', {
                  enum: ['localized', 'dot', 'dash', 'slash'],
                  type: 'string',
                }),
                defaultValue: 'localized',
              } as any,
            },
            {
              name: 'dateStyle',
              title: '日期格式',
              setter: selectSetter([
                { label: '完整', value: 'full' },
                { label: '长', value: 'long' },
                { label: '中', value: 'medium' },
                { label: '短', value: 'short' },
              ]),
              extraProps: {
                agent: propAgentCapability('dateStyle', {
                  enum: ['full', 'long', 'medium', 'short'],
                  type: 'string',
                }),
                defaultValue: 'medium',
              } as any,
            },
            {
              name: 'timeFormat',
              title: '时间精度',
              setter: selectSetter([
                { label: '本地化', value: 'localized' },
                { label: '时分', value: 'hm' },
                { label: '时分秒', value: 'hms' },
              ]),
              extraProps: {
                agent: propAgentCapability('timeFormat', {
                  enum: ['localized', 'hm', 'hms'],
                  type: 'string',
                }),
                defaultValue: 'localized',
              } as any,
            },
            {
              name: 'timeStyle',
              title: '时间格式',
              setter: selectSetter([
                { label: '完整', value: 'full' },
                { label: '长', value: 'long' },
                { label: '中', value: 'medium' },
                { label: '短', value: 'short' },
              ]),
              extraProps: {
                agent: propAgentCapability('timeStyle', {
                  enum: ['full', 'long', 'medium', 'short'],
                  type: 'string',
                }),
                defaultValue: 'medium',
              } as any,
            },
            {
              name: 'hour12',
              title: '12 小时制',
              setter: 'SwitchSetter',
              extraProps: {
                agent: propAgentCapability('hour12', { type: 'boolean' }),
                defaultValue: false,
              } as any,
            },
            {
              name: 'timeZone',
              title: '时区',
              setter: selectSetter([
                { label: '本地时区', value: 'local' },
                { label: '中国标准时间', value: 'Asia/Shanghai' },
                { label: 'UTC', value: 'UTC' },
              ]),
              extraProps: {
                agent: propAgentCapability('timeZone', {
                  enum: ['local', 'Asia/Shanghai', 'UTC'],
                  type: 'string',
                }),
                defaultValue: 'local',
              } as any,
            },
            {
              name: 'updateInterval',
              title: '刷新频率',
              setter: selectSetter([
                { label: '每秒', value: 'second' },
                { label: '每分钟', value: 'minute' },
              ]),
              extraProps: {
                agent: propAgentCapability('updateInterval', { enum: ['second', 'minute'], type: 'string' }),
                defaultValue: 'second',
              } as any,
            },
            {
              type: 'group',
              title: '文字样式',
              setter: { componentName: 'CollapseSetter', props: { icon: false } },
              items: [
                {
                  name: 'color',
                  title: '颜色',
                  setter: 'ColorSetter',
                  extraProps: {
                    agent: propAgentCapability('color', { type: 'string' }),
                    defaultValue: '#1f2937',
                  } as any,
                },
                {
                  name: 'fontSize',
                  title: '字号',
                  setter: 'NumberSetter',
                  extraProps: {
                    agent: propAgentCapability('fontSize', { minimum: 1, type: 'number' }),
                    defaultValue: 24,
                  } as any,
                },
                {
                  name: 'fontWeight',
                  title: '字重',
                  setter: 'NumberSetter',
                  extraProps: {
                    agent: propAgentCapability('fontWeight', { maximum: 900, minimum: 100, type: 'number' }),
                    defaultValue: 600,
                  } as any,
                },
                {
                  name: 'textAlign',
                  title: '对齐',
                  setter: selectSetter([
                    { label: '左对齐', value: 'left' },
                    { label: '居中', value: 'center' },
                    { label: '右对齐', value: 'right' },
                  ]),
                  extraProps: {
                    agent: propAgentCapability('textAlign', { enum: ['left', 'center', 'right'], type: 'string' }),
                    defaultValue: 'left',
                  } as any,
                },
                {
                  name: 'letterSpacing',
                  title: '字间距',
                  setter: 'NumberSetter',
                  extraProps: {
                    agent: propAgentCapability('letterSpacing', { type: 'number' }),
                    defaultValue: 0,
                  } as any,
                },
              ],
            },
            {
              type: 'group',
              title: '基础属性',
              setter: { componentName: 'CollapseSetter', props: { icon: false } },
              items: [
                {
                  name: 'rect',
                  title: '位置尺寸',
                  setter: 'RectSetter',
                  extraProps: {
                    agent: rectAgentCapability,
                    getValue(target: any) {
                      return (target.getNode() as Node).getDashboardRect()
                    },
                    setValue(target: any, value: { x?: number; y?: number; width?: number; height?: number }) {
                      const node = target.getNode() as Node
                      const current = node.getDashboardRect()
                      updateNodeRect(node, { x: value.x ?? current.x, y: value.y ?? current.y })
                      node.updateDashboardRect({
                        height: value.height ?? current.height,
                        width: value.width ?? current.width,
                      })
                    },
                  } as any,
                },
              ],
            },
          ],
        },
        {
          type: 'group',
          key: 'advanced',
          title: '高级',
          items: [
            {
              name: 'nodeInfo',
              title: '节点信息',
              setter: 'NodeInfoSetter',
              extraProps: { agent: { expose: false }, label: false } as any,
            },
            {
              name: 'condition',
              title: '显隐',
              setter: 'SwitchSetter',
              extraProps: {
                agent: visibilityAgentCapability,
                supportVariable: true,
                getValue(target: any) {
                  return target.getNode().getExtraPropValue('condition')
                },
                setValue(target: any, value: boolean) {
                  target.getNode().setExtraProp('condition', value)
                },
              } as any,
            },
          ],
        },
      ],
    },
  ],
  component: {},
  supports: {},
  advanced: { view: DateTime },
}

export default configure
