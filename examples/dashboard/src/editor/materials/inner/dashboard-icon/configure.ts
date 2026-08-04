import type { Configure, Node } from '@easy-editor/core'
import { updateNodeRect } from '@easy-editor/plugin-dashboard'
import DashboardIcon from './component'

const propAgentCapability = (name: string, valueSchema: Record<string, unknown>) => ({
  access: 'read-write',
  fieldId: `dashboardIcon.${name}`,
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

const iconNames = [
  'factory',
  'sprout',
  'government',
  'waves',
  'island',
  'mine',
  'trees',
  'mountain',
  'map',
  'gauge',
  'bird',
  'fish',
  'paw',
  'shell',
]

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
              name: 'icon',
              title: '图标',
              setter: {
                componentName: 'SelectSetter',
                props: { options: iconNames.map(value => ({ label: value, value })) },
              },
              extraProps: {
                agent: propAgentCapability('icon', { type: 'string', enum: iconNames }),
                defaultValue: 'factory',
              } as any,
            },
            {
              name: 'color',
              title: '线条颜色',
              setter: 'ColorSetter',
              extraProps: { agent: propAgentCapability('color', { type: 'string' }), defaultValue: '#8fdcff' } as any,
            },
            {
              name: 'background',
              title: '背景',
              setter: 'StringSetter',
              extraProps: {
                agent: propAgentCapability('background', { type: 'string' }),
                defaultValue: 'transparent',
              } as any,
            },
            {
              name: 'borderColor',
              title: '边框颜色',
              setter: 'ColorSetter',
              extraProps: {
                agent: propAgentCapability('borderColor', { type: 'string' }),
                defaultValue: 'transparent',
              } as any,
            },
            {
              name: 'borderWidth',
              title: '边框宽度',
              setter: 'NumberSetter',
              extraProps: {
                agent: propAgentCapability('borderWidth', { type: 'number', minimum: 0, maximum: 12 }),
                defaultValue: 0,
              } as any,
            },
            {
              name: 'borderRadius',
              title: '圆角',
              setter: 'NumberSetter',
              extraProps: {
                agent: propAgentCapability('borderRadius', { type: 'number', minimum: 0, maximum: 64 }),
                defaultValue: 0,
              } as any,
            },
            {
              name: 'padding',
              title: '内边距',
              setter: 'NumberSetter',
              extraProps: {
                agent: propAgentCapability('padding', { type: 'number', minimum: 0, maximum: 48 }),
                defaultValue: 8,
              } as any,
            },
            {
              name: 'strokeWidth',
              title: '线条粗细',
              setter: 'NumberSetter',
              extraProps: {
                agent: propAgentCapability('strokeWidth', { type: 'number', minimum: 0.5, maximum: 4 }),
                defaultValue: 1.6,
              } as any,
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
  advanced: { view: DashboardIcon },
}

export default configure
