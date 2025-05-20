import type { Event } from '@/editor/setters/basic/event-setter'
import { systemFonts } from '@/editor/utils'
import type { Configure } from '@easy-editor/core'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
} from 'lucide-react'
import { generalAdvancedConfigure, generalBasicConfigure } from '../../configure'
import Button from './component'

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
          title: '基本',
          items: [
            ...generalBasicConfigure,
            {
              type: 'group',
              setter: 'SubTabSetter',
              items: [
                {
                  type: 'group',
                  key: 'basic',
                  title: '全局',
                  items: [
                    {
                      name: 'textDirection',
                      title: '文字方向',
                      setter: {
                        componentName: 'RadioSetter',
                        props: {
                          // orientation: '',
                          options: [
                            {
                              label: '横排',
                              value: 'horizontal',
                            },
                            {
                              label: '竖排',
                              value: 'vertical',
                            },
                          ],
                        },
                      },
                    },
                    {
                      name: 'horizontalAlign',
                      title: '水平对齐',
                      setter: {
                        componentName: 'ToggleSetter',
                        props: {
                          options: [
                            {
                              label: '左对齐',
                              value: 'flex-start',
                              icon: <AlignLeft />,
                            },
                            {
                              label: '居中',
                              value: 'center',
                              icon: <AlignCenter />,
                            },
                            {
                              label: '右对齐',
                              value: 'flex-end',
                              icon: <AlignRight />,
                            },
                          ],
                        },
                      },
                    },
                    {
                      name: 'verticalAlign',
                      title: '垂直对齐',
                      setter: {
                        componentName: 'ToggleSetter',
                        props: {
                          options: [
                            {
                              label: '上对齐',
                              value: 'flex-start',
                              icon: <AlignVerticalJustifyStart />,
                            },
                            {
                              label: '居中',
                              value: 'center',
                              icon: <AlignVerticalJustifyCenter />,
                            },
                            {
                              label: '下对齐',
                              value: 'flex-end',
                              icon: <AlignVerticalJustifyEnd />,
                            },
                          ],
                        },
                      },
                    },

                    {
                      name: 'variant',
                      title: '按钮样式',
                      setter: {
                        componentName: 'SelectSetter',
                        props: {
                          options: [
                            {
                              label: '默认',
                              value: 'default',
                            },
                            {
                              label: '次要',
                              value: 'secondary',
                            },
                            {
                              label: '危险',
                              value: 'destructive',
                            },
                            {
                              label: '线框',
                              value: 'outline',
                            },
                            {
                              label: '幽灵',
                              value: 'ghost',
                            },
                            {
                              label: '链接',
                              value: 'link',
                            },
                          ],
                        },
                      },
                    },
                    {
                      name: 'loading',
                      title: '加载',
                      setter: 'SwitchSetter',
                    },
                  ],
                },
                {
                  type: 'group',
                  key: 'test',
                  title: '样式',
                  items: [
                    {
                      type: 'group',
                      setter: 'ToggleGroupSetter',
                      items: [
                        {
                          type: 'group',
                          key: 'default',
                          title: '默认',
                          items: [
                            {
                              name: 'radius',
                              title: '圆角',
                              setter: {
                                componentName: 'NumberSetter',
                                props: {
                                  suffix: 'px',
                                },
                              },
                            },
                            {
                              type: 'group',
                              title: '文字',
                              setter: {
                                componentName: 'AccordionSetter',
                                props: {
                                  orientation: 'horizontal',
                                },
                              },
                              items: [
                                {
                                  name: 'text.fontFamily',
                                  title: '字体',
                                  setter: {
                                    componentName: 'SelectSetter',
                                    props: {
                                      options: systemFonts,
                                    },
                                  },
                                },
                                {
                                  name: 'text.fontSize',
                                  title: '字体大小',
                                  setter: {
                                    componentName: 'NumberSetter',
                                    props: {
                                      suffix: 'px',
                                    },
                                  },
                                },
                                {
                                  name: 'text.color',
                                  title: '字体颜色',
                                  setter: 'ColorSetter',
                                },
                                {
                                  name: 'text.fontWeight',
                                  title: '字体粗细',
                                  setter: 'SwitchSetter',
                                },
                                {
                                  name: 'text.fontStyle',
                                  title: '斜体',
                                  setter: 'SwitchSetter',
                                },
                                {
                                  name: 'text.letterSpacing',
                                  title: '字距',
                                  setter: {
                                    componentName: 'NumberSetter',
                                    props: {
                                      suffix: 'px',
                                    },
                                  },
                                },
                                {
                                  name: 'text.lineHeight',
                                  title: '行高',
                                  setter: {
                                    componentName: 'NumberSetter',
                                    props: {
                                      suffix: 'px',
                                    },
                                  },
                                },
                              ],
                            },
                            {
                              type: 'group',
                              title: '背景',
                              setter: {
                                componentName: 'AccordionSetter',
                                props: {
                                  orientation: 'horizontal',
                                },
                              },
                              items: [
                                {
                                  name: 'background.color',
                                  title: '颜色',
                                  setter: 'ColorSetter',
                                },
                              ],
                            },
                            {
                              type: 'group',
                              title: '边框',
                              setter: {
                                componentName: 'AccordionSetter',
                                props: {
                                  orientation: 'horizontal',
                                },
                              },
                              items: [
                                {
                                  name: 'border.type',
                                  title: '线条类型',
                                  setter: {
                                    componentName: 'SelectSetter',
                                    props: {
                                      options: [
                                        {
                                          label: '实线',
                                          value: 'solid',
                                        },
                                        {
                                          label: '虚线',
                                          value: 'dashed',
                                        },
                                        {
                                          label: '点线',
                                          value: 'dotted',
                                        },
                                      ],
                                    },
                                  },
                                },
                                {
                                  name: 'border.width',
                                  title: '线条宽度',
                                  setter: {
                                    componentName: 'NumberSetter',
                                    props: {
                                      suffix: 'px',
                                    },
                                  },
                                },
                                {
                                  name: 'border.color',
                                  title: '线条颜色',
                                  setter: 'ColorSetter',
                                },
                              ],
                            },
                            {
                              type: 'group',
                              title: '图标',
                              setter: {
                                componentName: 'AccordionSetter',
                                props: {
                                  orientation: 'horizontal',
                                },
                              },
                              items: [
                                {
                                  name: 'icon.enable',
                                  title: '显示',
                                  setter: 'SwitchSetter',
                                },
                                // {
                                //   name: 'icon.name',
                                //   title: '图标',
                                //   setter: 'IconSetter',
                                // },
                                {
                                  name: 'icon.size',
                                  title: '尺寸',
                                  setter: {
                                    componentName: 'NumberSetter',
                                    props: {
                                      suffix: 'px',
                                    },
                                  },
                                },
                              ],
                            },
                          ],
                        },
                        {
                          type: 'group',
                          key: 'click',
                          title: '点击',
                          items: [
                            {
                              name: 'radius',
                              title: '圆角',
                              setter: {
                                componentName: 'NumberSetter',
                                props: {
                                  suffix: 'px',
                                },
                              },
                            },
                            {
                              type: 'group',
                              title: '文字',
                              setter: {
                                componentName: 'AccordionSetter',
                                props: {
                                  orientation: 'horizontal',
                                },
                              },
                              items: [
                                {
                                  name: 'text.fontFamily',
                                  title: '字体',
                                  setter: {
                                    componentName: 'SelectSetter',
                                    props: {
                                      options: systemFonts,
                                    },
                                  },
                                },
                                {
                                  name: 'text.fontSize',
                                  title: '字体大小',
                                  setter: {
                                    componentName: 'NumberSetter',
                                    props: {
                                      suffix: 'px',
                                    },
                                  },
                                },
                                {
                                  name: 'text.color',
                                  title: '字体颜色',
                                  setter: 'ColorSetter',
                                },
                                {
                                  name: 'text.fontWeight',
                                  title: '字体粗细',
                                  setter: 'SwitchSetter',
                                },
                                {
                                  name: 'text.fontStyle',
                                  title: '斜体',
                                  setter: 'SwitchSetter',
                                },
                                {
                                  name: 'text.letterSpacing',
                                  title: '字距',
                                  setter: {
                                    componentName: 'NumberSetter',
                                    props: {
                                      suffix: 'px',
                                    },
                                  },
                                },
                                {
                                  name: 'text.lineHeight',
                                  title: '行高',
                                  setter: {
                                    componentName: 'NumberSetter',
                                    props: {
                                      suffix: 'px',
                                    },
                                  },
                                },
                              ],
                            },
                            {
                              type: 'group',
                              title: '背景',
                              setter: {
                                componentName: 'AccordionSetter',
                                props: {
                                  orientation: 'horizontal',
                                },
                              },
                              items: [
                                {
                                  name: 'background.color',
                                  title: '颜色',
                                  setter: 'ColorSetter',
                                },
                              ],
                            },
                            {
                              type: 'group',
                              title: '边框',
                              setter: {
                                componentName: 'AccordionSetter',
                                props: {
                                  orientation: 'horizontal',
                                },
                              },
                              items: [
                                {
                                  name: 'border.type',
                                  title: '线条类型',
                                  setter: {
                                    componentName: 'SelectSetter',
                                    props: {
                                      options: [
                                        {
                                          label: '实线',
                                          value: 'solid',
                                        },
                                        {
                                          label: '虚线',
                                          value: 'dashed',
                                        },
                                        {
                                          label: '点线',
                                          value: 'dotted',
                                        },
                                      ],
                                    },
                                  },
                                },
                                {
                                  name: 'border.width',
                                  title: '线条宽度',
                                  setter: {
                                    componentName: 'NumberSetter',
                                    props: {
                                      suffix: 'px',
                                    },
                                  },
                                },
                                {
                                  name: 'border.color',
                                  title: '线条颜色',
                                  setter: 'ColorSetter',
                                },
                              ],
                            },
                            {
                              type: 'group',
                              title: '图标',
                              setter: {
                                componentName: 'AccordionSetter',
                                props: {
                                  orientation: 'horizontal',
                                },
                              },
                              items: [
                                {
                                  name: 'icon.enable',
                                  title: '显示',
                                  setter: 'SwitchSetter',
                                },
                                // {
                                //   name: 'icon.name',
                                //   title: '图标',
                                //   setter: 'IconSetter',
                                // },
                                {
                                  name: 'icon.size',
                                  title: '尺寸',
                                  setter: {
                                    componentName: 'NumberSetter',
                                    props: {
                                      suffix: 'px',
                                    },
                                  },
                                },
                              ],
                            },
                          ],
                        },
                        {
                          type: 'group',
                          key: 'hover',
                          title: '悬停',
                          items: [
                            {
                              name: 'radius',
                              title: '圆角',
                              setter: {
                                componentName: 'NumberSetter',
                                props: {
                                  suffix: 'px',
                                },
                              },
                            },
                            {
                              type: 'group',
                              title: '文字',
                              setter: {
                                componentName: 'AccordionSetter',
                                props: {
                                  orientation: 'horizontal',
                                },
                              },
                              items: [
                                {
                                  name: 'text.fontFamily',
                                  title: '字体',
                                  setter: {
                                    componentName: 'SelectSetter',
                                    props: {
                                      options: systemFonts,
                                    },
                                  },
                                },
                                {
                                  name: 'text.fontSize',
                                  title: '字体大小',
                                  setter: {
                                    componentName: 'NumberSetter',
                                    props: {
                                      suffix: 'px',
                                    },
                                  },
                                },
                                {
                                  name: 'text.color',
                                  title: '字体颜色',
                                  setter: 'ColorSetter',
                                },
                                {
                                  name: 'text.fontWeight',
                                  title: '字体粗细',
                                  setter: 'SwitchSetter',
                                },
                                {
                                  name: 'text.fontStyle',
                                  title: '斜体',
                                  setter: 'SwitchSetter',
                                },
                                {
                                  name: 'text.letterSpacing',
                                  title: '字距',
                                  setter: {
                                    componentName: 'NumberSetter',
                                    props: {
                                      suffix: 'px',
                                    },
                                  },
                                },
                                {
                                  name: 'text.lineHeight',
                                  title: '行高',
                                  setter: {
                                    componentName: 'NumberSetter',
                                    props: {
                                      suffix: 'px',
                                    },
                                  },
                                },
                              ],
                            },
                            {
                              type: 'group',
                              title: '背景',
                              setter: {
                                componentName: 'AccordionSetter',
                                props: {
                                  orientation: 'horizontal',
                                },
                              },
                              items: [
                                {
                                  name: 'background.color',
                                  title: '颜色',
                                  setter: 'ColorSetter',
                                },
                              ],
                            },
                            {
                              type: 'group',
                              title: '边框',
                              setter: {
                                componentName: 'AccordionSetter',
                                props: {
                                  orientation: 'horizontal',
                                },
                              },
                              items: [
                                {
                                  name: 'border.type',
                                  title: '线条类型',
                                  setter: {
                                    componentName: 'SelectSetter',
                                    props: {
                                      options: [
                                        {
                                          label: '实线',
                                          value: 'solid',
                                        },
                                        {
                                          label: '虚线',
                                          value: 'dashed',
                                        },
                                        {
                                          label: '点线',
                                          value: 'dotted',
                                        },
                                      ],
                                    },
                                  },
                                },
                                {
                                  name: 'border.width',
                                  title: '线条宽度',
                                  setter: {
                                    componentName: 'NumberSetter',
                                    props: {
                                      suffix: 'px',
                                    },
                                  },
                                },
                                {
                                  name: 'border.color',
                                  title: '线条颜色',
                                  setter: 'ColorSetter',
                                },
                              ],
                            },
                            {
                              type: 'group',
                              title: '图标',
                              setter: {
                                componentName: 'AccordionSetter',
                                props: {
                                  orientation: 'horizontal',
                                },
                              },
                              items: [
                                {
                                  name: 'icon.enable',
                                  title: '显示',
                                  setter: 'SwitchSetter',
                                },
                                // {
                                //   name: 'icon.name',
                                //   title: '图标',
                                //   setter: 'IconSetter',
                                // },
                                {
                                  name: 'icon.size',
                                  title: '尺寸',
                                  setter: {
                                    componentName: 'NumberSetter',
                                    props: {
                                      suffix: 'px',
                                    },
                                  },
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
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
            ...generalAdvancedConfigure,
            {
              type: 'group',
              title: '事件设置',
              setter: {
                componentName: 'CollapseSetter',
                props: {
                  icon: false,
                },
              },
              items: [
                {
                  name: '__events',
                  title: '点击绑定事件',
                  setter: {
                    componentName: 'EventSetter',
                    props: {
                      events: [
                        {
                          title: '组件自带事件',
                          children: [
                            {
                              label: 'onClick',
                              value: 'onClick',
                              description: '点击事件',
                            },
                          ],
                        },
                      ],
                    },
                  },
                  extraProps: {
                    wrap: true,
                    setValue(target, value: Event, oldValue: Event) {
                      const { eventDataList } = value
                      const { eventList: oldEventList } = oldValue

                      // 删除老事件
                      Array.isArray(oldEventList) &&
                        oldEventList.map(item => {
                          target.parent.clearPropValue(item.name)
                          return item
                        })

                      // 重新添加新事件
                      Array.isArray(eventDataList) &&
                        eventDataList.map(item => {
                          target.parent.setPropValue(item.name, {
                            type: 'JSFunction',
                            // 需要传下入参
                            value: `function(){return this.${
                              item.relatedEventName
                            }.apply(this,Array.prototype.slice.call(arguments).concat([${item.paramStr ? item.paramStr : ''}])) }`,
                          })
                          return item
                        })

                      console.log('target', target.getNode().export())
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  component: {},
  supports: {},
  advanced: {
    view: Button,
  },
}

export default configure
