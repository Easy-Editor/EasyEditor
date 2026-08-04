import type { Configure, Node } from '@easy-editor/core'
import { updateNodeRect } from '@easy-editor/plugin-dashboard'
import GlobeScene from './component'
import { DEFAULT_GLOBE_SCENE_SPEC } from './spec'

const propAgentCapability = (name: string, valueSchema: Record<string, unknown>) => ({
  access: 'read-write',
  fieldId: `globeScene.${name}`,
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
    additionalProperties: false,
    required: ['x', 'y', 'width', 'height'],
    properties: {
      x: { type: 'number' },
      y: { type: 'number' },
      width: { type: 'number', minimum: 1 },
      height: { type: 'number', minimum: 1 },
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

const cssColorSchema = {
  type: 'string',
  maxLength: 64,
}

const shaderColorSchema = {
  type: 'string',
  maxLength: 9,
}

const markersSchema = {
  type: 'array',
  maxItems: 24,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['longitude', 'latitude'],
    properties: {
      longitude: { type: 'number', minimum: -180, maximum: 180 },
      latitude: { type: 'number', minimum: -90, maximum: 90 },
      label: { type: 'string', maxLength: 36 },
      color: cssColorSchema,
      value: { type: ['number', 'string'], maxLength: 36 },
    },
  },
}

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
              type: 'group',
              title: '深空背景',
              setter: { componentName: 'CollapseSetter', props: { icon: false } },
              items: [
                {
                  name: 'background',
                  title: '背景色',
                  setter: 'ColorSetter',
                  extraProps: {
                    agent: propAgentCapability('background', cssColorSchema),
                    defaultValue: DEFAULT_GLOBE_SCENE_SPEC.background,
                  } as any,
                },
                {
                  name: 'starDensity',
                  title: '星点密度',
                  setter: 'NumberSetter',
                  extraProps: {
                    agent: propAgentCapability('starDensity', { type: 'number', minimum: 0, maximum: 1 }),
                    defaultValue: DEFAULT_GLOBE_SCENE_SPEC.starDensity,
                  } as any,
                },
              ],
            },
            {
              type: 'group',
              title: '地球外观',
              setter: { componentName: 'CollapseSetter', props: { icon: false } },
              items: [
                {
                  name: 'oceanColor',
                  title: '海洋色',
                  setter: 'ColorSetter',
                  extraProps: {
                    agent: propAgentCapability('oceanColor', shaderColorSchema),
                    defaultValue: DEFAULT_GLOBE_SCENE_SPEC.oceanColor,
                  } as any,
                },
                {
                  name: 'landColor',
                  title: '陆地色',
                  setter: 'ColorSetter',
                  extraProps: {
                    agent: propAgentCapability('landColor', shaderColorSchema),
                    defaultValue: DEFAULT_GLOBE_SCENE_SPEC.landColor,
                  } as any,
                },
                {
                  name: 'atmosphereColor',
                  title: '大气光颜色',
                  setter: 'ColorSetter',
                  extraProps: {
                    agent: propAgentCapability('atmosphereColor', shaderColorSchema),
                    defaultValue: DEFAULT_GLOBE_SCENE_SPEC.atmosphereColor,
                  } as any,
                },
                {
                  name: 'surfaceBrightness',
                  title: '表面亮度',
                  setter: 'NumberSetter',
                  extraProps: {
                    agent: propAgentCapability('surfaceBrightness', {
                      type: 'number',
                      minimum: 0.35,
                      maximum: 1.2,
                    }),
                    defaultValue: DEFAULT_GLOBE_SCENE_SPEC.surfaceBrightness,
                  } as any,
                },
                {
                  name: 'ambientLight',
                  title: '环境光',
                  setter: 'NumberSetter',
                  extraProps: {
                    agent: propAgentCapability('ambientLight', { type: 'number', minimum: 0.04, maximum: 0.5 }),
                    defaultValue: DEFAULT_GLOBE_SCENE_SPEC.ambientLight,
                  } as any,
                },
                {
                  name: 'daylightIntensity',
                  title: '日光强度',
                  setter: 'NumberSetter',
                  extraProps: {
                    agent: propAgentCapability('daylightIntensity', {
                      type: 'number',
                      minimum: 0.3,
                      maximum: 1.4,
                    }),
                    defaultValue: DEFAULT_GLOBE_SCENE_SPEC.daylightIntensity,
                  } as any,
                },
                {
                  name: 'lightAzimuth',
                  title: '光照方位角',
                  setter: 'NumberSetter',
                  extraProps: {
                    agent: propAgentCapability('lightAzimuth', {
                      type: 'number',
                      minimum: -180,
                      maximum: 180,
                    }),
                    defaultValue: DEFAULT_GLOBE_SCENE_SPEC.lightAzimuth,
                  } as any,
                },
                {
                  name: 'centerLongitude',
                  title: '中心经度',
                  setter: 'NumberSetter',
                  extraProps: {
                    agent: propAgentCapability('centerLongitude', {
                      type: 'number',
                      minimum: -180,
                      maximum: 180,
                    }),
                    defaultValue: DEFAULT_GLOBE_SCENE_SPEC.centerLongitude,
                  } as any,
                },
                {
                  name: 'centerLatitude',
                  title: '中心纬度',
                  setter: 'NumberSetter',
                  extraProps: {
                    agent: propAgentCapability('centerLatitude', {
                      type: 'number',
                      minimum: -70,
                      maximum: 70,
                    }),
                    defaultValue: DEFAULT_GLOBE_SCENE_SPEC.centerLatitude,
                  } as any,
                },
                {
                  name: 'globeScale',
                  title: '地球缩放',
                  setter: 'NumberSetter',
                  extraProps: {
                    agent: propAgentCapability('globeScale', { type: 'number', minimum: 0.35, maximum: 1.45 }),
                    defaultValue: DEFAULT_GLOBE_SCENE_SPEC.globeScale,
                  } as any,
                },
              ],
            },
            {
              type: 'group',
              title: '动态效果',
              setter: { componentName: 'CollapseSetter', props: { icon: false } },
              items: [
                {
                  name: 'autoRotate',
                  title: '自动旋转',
                  setter: 'SwitchSetter',
                  extraProps: {
                    agent: propAgentCapability('autoRotate', { type: 'boolean' }),
                    defaultValue: DEFAULT_GLOBE_SCENE_SPEC.autoRotate,
                  } as any,
                },
                {
                  name: 'rotationSpeed',
                  title: '旋转速度',
                  setter: 'NumberSetter',
                  extraProps: {
                    agent: propAgentCapability('rotationSpeed', { type: 'number', minimum: -8, maximum: 8 }),
                    defaultValue: DEFAULT_GLOBE_SCENE_SPEC.rotationSpeed,
                  } as any,
                },
                {
                  name: 'introAnimation',
                  title: '推进式入场',
                  setter: 'SwitchSetter',
                  extraProps: {
                    agent: propAgentCapability('introAnimation', { type: 'boolean' }),
                    defaultValue: DEFAULT_GLOBE_SCENE_SPEC.introAnimation,
                  } as any,
                },
                {
                  name: 'introDuration',
                  title: '入场时长（毫秒）',
                  setter: 'NumberSetter',
                  extraProps: {
                    agent: propAgentCapability('introDuration', {
                      type: 'number',
                      minimum: 600,
                      maximum: 10_000,
                    }),
                    defaultValue: DEFAULT_GLOBE_SCENE_SPEC.introDuration,
                  } as any,
                },
                {
                  name: 'introLoop',
                  title: '循环入场',
                  setter: 'SwitchSetter',
                  extraProps: {
                    agent: propAgentCapability('introLoop', { type: 'boolean' }),
                    defaultValue: DEFAULT_GLOBE_SCENE_SPEC.introLoop,
                  } as any,
                },
              ],
            },
            {
              name: 'markers',
              title: '资源点',
              setter: { componentName: 'JsonSetter', defaultValue: DEFAULT_GLOBE_SCENE_SPEC.markers },
              extraProps: { agent: propAgentCapability('markers', markersSchema) } as any,
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
                        width: value.width ?? current.width,
                        height: value.height ?? current.height,
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
  advanced: { view: GlobeScene },
}

export default configure
