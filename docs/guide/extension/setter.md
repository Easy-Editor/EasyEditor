# 自定义属性设置器

属性设置器（Setter）是 EasyEditor 中用于编辑组件属性的交互控件。本指南将帮助你了解如何创建自定义的属性设置器，以满足特定的编辑需求。

## 概述

Setter 是一种特殊的组件，用于在设计器中为特定类型的属性提供可视化的编辑界面。EasyEditor 内置了一系列基础的 Setter，如文本输入、数字输入、颜色选择器等，但在某些场景下，你可能需要创建自定义的 Setter 来提供更专业或更便捷的编辑体验。

Setter 的主要职责包括：

- 展示属性当前值
- 提供交互界面修改属性值
- 验证输入的有效性
- 转换数据格式
- 提供友好的用户体验

## 目录结构

一个完整的 Setter 项目通常包含以下文件结构：

```bash
my-setter/
├── index.tsx       # Setter 组件实现
```

## 使用

### 基础 Setter 组件 (index.tsx)

一个基本的 Setter 组件需要实现 `SetterProps` 接口：

```tsx
import React from 'react'
import type { SetterProps } from '@easy-editor/core'

export interface CustomSetterProps extends SetterProps {
  // 自定义属性
  placeholder?: string;
  options?: Array<{ label: string; value: any }>;
}

const CustomSetter: React.FC<CustomSetterProps> = (props) => {
  const { value, onChange, placeholder, options = [] } = props;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value);
  };

  return (
    <select
      value={value}
      onChange={handleChange}
      className="w-full px-2 py-1 border rounded"
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
};

export default CustomSetter;
```

### 复合属性 Setter (index.tsx)

对于包含多个子属性的复合属性，如边距、定位等，可以创建复合 Setter：

```tsx
import React from 'react'
import type { SetterProps } from '@easy-editor/core'

interface MarginValue {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

interface MarginSetterProps extends SetterProps<MarginValue> {
  units?: string[];
  defaultUnit?: string;
}

const MarginSetter: React.FC<MarginSetterProps> = (props) => {
  const { value = {}, onChange, units = ['px', '%', 'rem'], defaultUnit = 'px' } = props;
  const [selectedUnit, setSelectedUnit] = React.useState(defaultUnit);

  const handleChange = (key: keyof MarginValue, val: string) => {
    const numValue = parseFloat(val);
    onChange({
      ...value,
      [key]: isNaN(numValue) ? undefined : numValue,
    });
  };

  const handleUnitChange = (unit: string) => {
    setSelectedUnit(unit);
    // 可以在这里实现单位转换逻辑
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="flex items-center">
        <label className="text-xs mr-2">上:</label>
        <input
          type="number"
          value={value.top ?? ''}
          onChange={(e) => handleChange('top', e.target.value)}
          className="w-full px-2 py-1 border rounded"
        />
      </div>
      <div className="flex items-center">
        <label className="text-xs mr-2">右:</label>
        <input
          type="number"
          value={value.right ?? ''}
          onChange={(e) => handleChange('right', e.target.value)}
          className="w-full px-2 py-1 border rounded"
        />
      </div>
      <div className="flex items-center">
        <label className="text-xs mr-2">下:</label>
        <input
          type="number"
          value={value.bottom ?? ''}
          onChange={(e) => handleChange('bottom', e.target.value)}
          className="w-full px-2 py-1 border rounded"
        />
      </div>
      <div className="flex items-center">
        <label className="text-xs mr-2">左:</label>
        <input
          type="number"
          value={value.left ?? ''}
          onChange={(e) => handleChange('left', e.target.value)}
          className="w-full px-2 py-1 border rounded"
        />
      </div>
      <div className="col-span-2 flex justify-end">
        <select
          value={selectedUnit}
          onChange={(e) => handleUnitChange(e.target.value)}
          className="text-xs px-1 border rounded"
        >
          {units.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

export default MarginSetter;
```

### 集成第三方库 Setter

有时我们需要集成第三方库来提供更专业的编辑体验，如颜色选择器、日期选择器等：

```tsx
import React from 'react'
import type { SetterProps } from '@easy-editor/core'
import { SketchPicker } from 'react-color'

interface ColorSetterProps extends SetterProps<string> {
  presetColors?: string[];
  showAlpha?: boolean;
}

const ColorSetter: React.FC<ColorSetterProps> = (props) => {
  const { value = '#000000', onChange, presetColors, showAlpha = true } = props;
  const [isOpen, setIsOpen] = React.useState(false);

  const handleClick = () => {
    setIsOpen(!isOpen);
  };

  const handleChange = (color: any) => {
    onChange(color.hex);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <div
        className="w-full h-8 rounded cursor-pointer border flex items-center px-2"
        style={{ backgroundColor: value }}
        onClick={handleClick}
      >
        <span className="text-xs text-white shadow-sm">{value}</span>
      </div>
      {isOpen && (
        <div className="absolute z-10 mt-1">
          <div className="fixed inset-0" onClick={handleClose} />
          <SketchPicker
            color={value}
            onChange={handleChange}
            presetColors={presetColors}
            disableAlpha={!showAlpha}
          />
        </div>
      )}
    </div>
  );
};

export default ColorSetter;
```

### 高级事件 Setter

Setter 可以访问设计器、文档和节点，实现更复杂的功能，如事件绑定：

```tsx
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { JSFunction, SetterProps } from '@easy-editor/core'
import { Settings, Trash } from 'lucide-react'
import { useState } from 'react'

interface EventData {
  type: string
  name: string
  relatedEventName: string
  paramStr?: string
}

export interface Event {
  eventDataList?: EventData[]
  eventList?: Array<{
    name: string
    description?: string
    disabled?: boolean
  }>
}

interface EventSetterProps extends SetterProps<Event> {
  events: Array<{
    title: string
    children: Array<{
      label: string
      value: string
      description?: string
    }>
  }>
  field: any // SettingField 类型
}

const EventSetter = (props: EventSetterProps) => {
  const { value, onChange, events, field } = props

  // 通过 field 可以访问设计器、文档和节点
  const methods = field.designer?.currentDocument?.rootNode?.getExtraPropValue('methods') as Record<string, JSFunction>

  // 其他状态和方法
  const [openKey, setOpenKey] = useState(0)
  const [open, setOpen] = useState(false)
  const [eventName, setEventName] = useState<string | undefined>(undefined)
  const [editEventName, setEditEventName] = useState<string | undefined>(undefined)

  const handleValueChange = (value: string) => {
    setOpenKey(prev => prev + 1)
    setOpen(true)
    setEventName(value)
  }

  const handleAddEvent = (eventName: string, method: string, params?: string) => {
    if (!eventName) return

    const newEventData: EventData = {
      type: 'method',
      name: eventName,
      relatedEventName: method,
    }

    if (params) {
      newEventData.paramStr = params
    }

    // 编辑现有事件
    if (editEventName) {
      onChange?.({
        ...value,
        eventDataList: value?.eventDataList?.map(item =>
          item.name === editEventName ? newEventData : item
        ),
      })
      setEditEventName(undefined)
    }
    // 添加新事件
    else {
      onChange?.({
        eventDataList: [...(value?.eventDataList || []), newEventData],
        eventList: [...(value?.eventList || []), { name: newEventData.name }],
      })
    }
  }

  const handleDeleteEvent = (eventData: EventData) => {
    onChange?.({
      eventDataList: value?.eventDataList?.filter(item => item.name !== eventData.name),
      eventList: value?.eventList?.filter(item => item.name !== eventData.name),
    })
  }

  return (
    <div className="flex flex-col space-y-4">
      {/* 事件选择 */}
      <div className="flex flex-col w-full">
        {events.map((event, index) => (
          <Select key={`${event.title}-${openKey}-${index}`} value={undefined} onValueChange={handleValueChange}>
            <SelectTrigger className="w-full justify-center text-xs">
              <SelectValue placeholder={event.title} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {event.children.map(child => (
                  <SelectItem
                    key={child.value}
                    value={child.value}
                    disabled={value?.eventDataList?.some(item => item.name === child.value)}
                    className="flex justify-between"
                  >
                    <span>{child.label}</span>
                    <span className="text-xs text-gray-500">{child.description}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ))}
      </div>

      {/* 事件列表 */}
      <Table className="mt-4">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[220px] text-xs">已有事件</TableHead>
            <TableHead className="text-xs">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {value?.eventDataList?.map(eventData => (
            <TableRow key={eventData.name}>
              <TableCell className="font-medium text-xs">
                {eventData.name}
                <span className="px-2">-</span>
                <Button variant="link" className="text-xs px-0 py-0 h-0">
                  {eventData.relatedEventName}
                </Button>
              </TableCell>
              <TableCell className="flex gap-2">
                <Settings
                  className="h-3 w-3 cursor-pointer"
                  onClick={() => {
                    setOpen(true)
                    setEventName(eventData.name)
                    setEditEventName(eventData.name)
                  }}
                />
                <Trash
                  className="h-3 w-3 cursor-pointer"
                  onClick={() => handleDeleteEvent(eventData)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* 事件编辑弹窗会在这里 */}
    </div>
  )
}

export default EventSetter
```

## 注册 Setter

创建完 Setter 组件后，需要将其注册到 EasyEditor 中：

```typescript
import { createEditor } from '@easy-editor/core'
import CustomSetter from './path/to/CustomSetter'
import MarginSetter from './path/to/MarginSetter'
import ColorSetter from './path/to/ColorSetter'
import EventSetter from './path/to/EventSetter'

// 在创建编辑器实例时注册
const editor = createEditor({
  // ...其他配置
  setters: {
    // 注册自定义设置器
    CustomSetter,
    MarginSetter,
    ColorSetter,
    EventSetter
  }
})
```

## 在物料中使用

在组件的属性配置中，可以通过指定 `setter` 字段来使用自定义的 Setter：

```typescript
import type { Configure } from '@easy-editor/core'

const configure: Configure = {
  props: [
    {
      type: 'group',
      title: '基础',
      setter: 'GroupSetter',
      items: [
        {
          type: 'field',
          name: 'type',
          title: '按钮类型',
          setter: 'CustomSetter',  // 使用自定义的 Setter
          extraProps: {
            placeholder: '请选择按钮类型',
            options: [
              { label: '主要按钮', value: 'primary' },
              { label: '次要按钮', value: 'secondary' },
              { label: '文本按钮', value: 'text' },
            ],
          }
        },
        {
          type: 'field',
          name: 'margin',
          title: '外边距',
          setter: 'MarginSetter',  // 使用自定义的复合 Setter
          extraProps: {
            units: ['px', 'rem', 'em'],
            defaultUnit: 'px'
          }
        },
        {
          type: 'field',
          name: 'backgroundColor',
          title: '背景色',
          setter: 'ColorSetter',  // 使用自定义的颜色 Setter
          extraProps: {
            presetColors: ['#FF5630', '#00B8D9', '#36B37E', '#6554C0', '#FFAB00'],
            showAlpha: true
          }
        }
      ]
    },
    {
      type: 'group',
      title: '事件设置',
      setter: 'CollapseSetter',
      items: [
        {
          name: '__events',
          title: '点击绑定事件',
          setter: {
            componentName: 'EventSetter',  // 使用事件设置器
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
            }
          },
          extraProps: {
            // 通过 setValue 可以实现高级的数据转换和处理
            setValue(target, value, oldValue) {
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
                    value: `function(){return this.${
                      item.relatedEventName
                    }.apply(this,Array.prototype.slice.call(arguments).concat([${item.paramStr ? item.paramStr : ''}])) }`,
                  })
                  return item
                })
            }
          }
        }
      ]
    }
  ]
}

export default configure
```

## 与设计器的交互

### 使用 field 属性

Setter 组件可以通过 `field` 属性访问设计器上下文，包括当前文档、选中节点等信息：

```tsx
import React from 'react'
import type { SetterProps } from '@easy-editor/core'

const AdvancedSetter: React.FC<SetterProps> = (props) => {
  const { value, onChange, field } = props;

  // 获取当前选中的节点
  const selectedNode = field.getNode();

  // 获取当前文档
  const currentDocument = field.designer?.currentDocument;

  // 获取组件元数据
  const componentMeta = selectedNode && currentDocument?.getComponentMeta(selectedNode.componentName);

  // 访问其他属性
  const otherPropValue = field.parent.getPropValue('otherProp');

  return (
    <div>
      <div>当前组件: {selectedNode?.componentName}</div>
      <div>
        <button onClick={() => onChange(value + 1)}>
          增加值
        </button>
      </div>
    </div>
  );
};

export default AdvancedSetter;
```

### 使用 extraProps

通过 `extraProps` 中的 `setValue` 和 `getValue` 方法，可以在值变更前后执行特殊处理：

```typescript
{
  name: 'complexProp',
  title: '复杂属性',
  setter: 'CustomSetter',
  extraProps: {
    // 将原始数据转换为 setter 可用格式
    getValue(target, fieldValue) {
      // 从原始数据中提取需要的部分
      return fieldValue?.someNestedValue || '';
    },

    // 将 setter 输出的值转换为组件需要的格式
    setValue(target, value, oldValue) {
      // 更新其他相关属性
      if (value === 'special') {
        target.parent.setPropValue('relatedProp', true);
      }

      // 返回处理后的值
      return {
        someNestedValue: value,
        timestamp: Date.now()
      };
    }
  }
}
```

### 访问文档和全局数据

Setter 可以通过 `field` 访问文档根节点和全局数据：

```tsx
const CustomSetter = (props: SetterProps) => {
  const { field } = props;

  // 获取全局变量
  const globalVariables = field.designer?.currentDocument?.rootNode?.getExtraPropValue('variables');

  // 获取全局方法
  const globalMethods = field.designer?.currentDocument?.rootNode?.getExtraPropValue('methods');

  // 使用全局数据渲染选项
  return (
    <select>
      {Object.keys(globalVariables || {}).map(key => (
        <option key={key} value={key}>
          {key}: {globalVariables[key]}
        </option>
      ))}
    </select>
  );
};
```
