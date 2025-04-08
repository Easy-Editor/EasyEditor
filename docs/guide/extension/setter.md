# 设置器扩展

设置器(Setter)是 EasyEditor 中用于配置组件属性的 UI 控件。本指南将帮助你了解如何开发和集成自定义设置器。

## 设置器介绍

设置器是属性配置面板中的基础 UI 控件，用于编辑组件的各种属性值。

## 设置器结构

一个完整的设置器包含以下文件结构：

```bash
string-setter/
├── index.tsx      # 设置器组件
```

## 设置器开发

### 1. 基础设置器

```typescript
import type { SetterProps } from '@easy-editor/core'

export interface StringSetterProps extends SetterProps<string> {
  placeholder?: string  // 自定义的设置器属性
}

const StringSetter = (props: StringSetterProps) => {
  const { value, placeholder, onChange } = props

  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className="w-full px-2 py-1 border rounded"
    />
  )
}

export default StringSetter
```

### 2. 分组设置器

分组设置器用于组织和管理其他设置器，通常不需要 `name` 属性。以下是常用的分组设置器简易实现：

#### GroupSetter
最基础的分组设置器，用于垂直排列多个设置器：

```typescript
import type { SetterProps } from '@easy-editor/core'
import type { PropsWithChildren } from 'react'

interface GroupSetterProps extends SetterProps<string>, PropsWithChildren {}

const GroupSetter = (props: GroupSetterProps) => {
  const { children } = props

  return <div className='space-y-4 flex flex-col gap-2'>{children}</div>
}

export default GroupSetter
```

#### CollapseSetter
可折叠的分组设置器，适用于需要收起/展开的复杂设置组：

```typescript
import type { SetterProps } from '@easy-editor/core'
import type { PropsWithChildren } from 'react'
import { useState } from 'react'
// ...

interface CollapseSetterProps extends SetterProps<boolean>, PropsWithChildren {
  icon?: boolean
}

const CollapseSetter = (props: CollapseSetterProps) => {
  const { field, children, initialValue, icon = true } = props
  const [isOpen, setIsOpen] = useState(initialValue ?? true)

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className='w-[calc(100%_+_32px)] space-y-2 -translate-x-4'
    >
      <div className='flex items-center justify-between space-x-4 px-4 h-8 bg-muted'>
        <h4>{field.title}</h4>
        {icon && (
          <CollapsibleTrigger asChild>
            <Button variant='ghost' size='sm'>
              <ChevronsUpDown className='h-4 w-4' />
              <span className='sr-only'>Toggle</span>
            </Button>
          </CollapsibleTrigger>
        )}
      </div>
      <CollapsibleContent className='space-y-3 px-4 py-2'>
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

export default CollapseSetter
```

分组设置器的使用示例：

```typescript
const configure: Configure = {
  props: [
    // 基础分组
    {
      type: 'group',
      title: '基础设置',
      setter: 'GroupSetter',
      items: [
        {
          name: 'content',
          title: '内容',
          setter: 'StringSetter'
        }
      ]
    },

    // 可折叠分组
    {
      type: 'group',
      title: '样式设置',
      setter: {
        componentName: 'CollapseSetter',
        props: {
          icon: true
        }
      },
      items: [
        {
          type: 'group',
          title: '文字',
          items: [
            {
              name: 'text.fontSize',
              title: '字体大小',
              setter: 'NumberSetter'
            }
          ]
        }
      ]
    }
  ]
}
```

## 设置器配置

在组件的 `configure.ts` 中使用设置器：

```typescript
import type { Configure } from '@easy-editor/core'

const configure: Configure = {
  props: [
    {
      type: 'field',·           // 设置器类型，分为 field、group
      name: 'content',          // 映射到物料上的配置属性
      title: '文本内容',         // 配置字段显示的名称
      setter: 'StringSetter',   // 选择的设置器
    },
  ]
}
```

### `setter` 属性的三种使用方式

在 EasyEditor 中，`setter` 可以通过以下三种方式进行配置：

#### 1. 字符串方式

最简单的配置方式，直接使用字符串指定设置器的名称。适用于不需要额外配置的简单设置器。

```typescript
{
  name: 'loading',
  title: '加载状态',
  setter: 'SwitchSetter'  // 直接使用字符串指定设置器
}
```

#### 2. 对象方式

当需要为设置器提供额外的配置项时，使用对象方式。对象必须包含 `componentName` 属性，可选包含 `props` 属性。

```typescript
{
  name: 'variant',
  title: '按钮样式',
  setter: {
    componentName: 'SelectSetter',  // 设置器名称
    props: {                        // 设置器属性
      options: [
        { label: '默认', value: 'default' },
        { label: '主要', value: 'primary' },
        { label: '危险', value: 'destructive' }
      ]
    }
  }
}
```

对象配置支持的完整属性：

```typescript
interface SetterConfig {
  componentName: string;           // 设置器名称（必需）
  props?: Record<string, any>;     // 传递给设置器的属性
  isRequired?: boolean;            // 是否必填
  defaultValue?: any;              // 默认值
}
```

#### 3. 函数方式

最灵活的配置方式，可以根据当前字段状态动态返回设置器配置。函数接收当前字段实例作为参数。

```typescript
{
  name: 'size',
  title: '尺寸',
  setter: (field: SettingField) => {
    // 根据其他字段值动态决定使用哪个设置器
    const type = field.getValue('type');

    if (type === 'number') {
      return {
        componentName: 'NumberSetter',
        props: {
          min: 0,
          max: 100,
          suffix: 'px'
        }
      };
    }

    return 'StringSetter';  // 可以返回字符串
  }
}
```

函数方式的类型定义：

```typescript
type DynamicSetter = (target: SettingField) => string | SetterConfig;
```

### 使用示例

下面是一个综合使用这三种方式的示例：

```typescript
const configure: Configure = {
  props: [
    {
      type: 'group',
      title: '基础设置',
      items: [
        // 1. 字符串方式
        {
          name: 'visible',
          title: '是否显示',
          setter: 'SwitchSetter'
        },

        // 2. 对象方式
        {
          name: 'align',
          title: '对齐方式',
          setter: {
            componentName: 'RadioSetter',
            props: {
              options: [
                { label: '左对齐', value: 'left' },
                { label: '居中', value: 'center' },
                { label: '右对齐', value: 'right' }
              ]
            }
          }
        },

        // 3. 函数方式
        {
          name: 'size',
          title: '尺寸',
          setter: (field) => {
            const unit = field.getValue('unit');
            return {
              componentName: 'NumberSetter',
              props: {
                suffix: unit || 'px',
                min: 0,
                step: unit === '%' ? 1 : 0.5
              }
            };
          }
        }
      ]
    }
  ]
};
```

### 最佳实践

1. **简单场景使用字符串方式**：对于开关、颜色选择等简单设置器，直接使用字符串方式。

2. **需要配置选项时使用对象方式**：当设置器需要额外配置（如下拉选项、最大最小值等），使用对象方式。

3. **动态场景使用函数方式**：当设置器的类型或配置需要根据其他字段值动态变化时，使用函数方式。

4. **复用配置**：对于常用的设置器配置，可以抽取为常量复用：

```typescript
const COMMON_NUMBER_SETTER = {
  componentName: 'NumberSetter',
  props: {
    min: 0,
    step: 1,
    suffix: 'px'
  }
};

// 在配置中复用
{
  name: 'width',
  title: '宽度',
  setter: COMMON_NUMBER_SETTER
}
```

## 注册设置器

在编辑器初始化时注册设置器：

```typescript
import { createEasyEditor } from '@easy-editor/core'
import StringSetter from './setters/string-setter'

const editor = createEasyEditor({
  setters: {
    // ...
    StringSetter,
  }
})
```

## 高级特性

在设置器配置中，`extraProps` 提供了丰富的扩展功能，让我们能够更灵活地控制设置器的行为。

### 1. 基础属性

```typescript
interface FieldExtraProps {
  // 是否必填
  isRequired?: boolean;

  // 默认值
  defaultValue?: any;

  // 默认是否折叠（用于折叠面板类设置器）
  defaultCollapsed?: boolean;

  // 是否支持变量配置
  supportVariable?: boolean;
}
```

### 2. 值处理机制

#### getValue
在获取值时进行转换或处理，常用于单位转换、格式化等场景：

```typescript
{
  name: 'text.fontSize',
  title: '字体大小',
  setter: {
    componentName: 'NumberSetter',
    props: {
      suffix: 'px'
    }
  },
  extraProps: {
    defaultValue: 14,
    getValue: (target: SettingField, value: number) => {
      // 确保返回值带有单位
      return value ? `${value}px` : '14px';
    }
  }
}
```

#### setValue
在设置值时进行转换或联动处理，可用于多属性关联设置：

```typescript
{
  name: 'border',
  title: '边框',
  setter: {
    componentName: 'SelectSetter',
    props: {
      options: [
        { label: '无边框', value: 'none' },
        { label: '实线边框', value: 'solid' }
      ]
    }
  },
  extraProps: {
    setValue: (target: SettingField, value: string) => {
      if (value === 'solid') {
        // 设置边框时联动设置其他属性
        target.parent.setPropValue('border.width', 1);
        target.parent.setPropValue('border.color', '#000000');
        target.parent.setPropValue('border.type', 'solid');
      } else {
        // 清除边框时联动清除其他属性
        target.parent.clearPropValue('border.width');
        target.parent.clearPropValue('border.color');
        target.parent.clearPropValue('border.type');
      }
    }
  }
}
```

#### onChange
在值变化时执行副作用，适用于需要联动更新其他设置的场景：

```typescript
{
  name: 'textDirection',
  title: '文字方向',
  setter: {
    componentName: 'RadioSetter',
    props: {
      options: [
        { label: '横排', value: 'horizontal' },
        { label: '竖排', value: 'vertical' }
      ]
    }
  },
  extraProps: {
    onChange: (target: SettingField, value: string) => {
      // 当文字方向改变时，调整对齐方式
      if (value === 'vertical') {
        target.parent.setPropValue('horizontalAlign', 'center');
        target.parent.setPropValue('verticalAlign', 'flex-start');
      }
    }
  }
}
```

### 3. 条件显示

使用 `condition` 控制设置器的显示逻辑：

```typescript
{
  name: 'icon.size',
  title: '图标大小',
  setter: {
    componentName: 'NumberSetter',
    props: {
      suffix: 'px'
    }
  },
  extraProps: {
    // 只有在启用图标时才显示此设置
    condition: (target: SettingField) => {
      return target.parent.getPropValue('icon.enable') === true;
    }
  }
}
```

### 4. 自动执行

使用 `autorun` 监听并响应值的变化：

```typescript
{
  name: 'variant',
  title: '按钮样式',
  setter: {
    componentName: 'SelectSetter',
    props: {
      options: [
        { label: '默认', value: 'default' },
        { label: '主要', value: 'primary' }
      ]
    }
  },
  extraProps: {
    autorun: (target: SettingField) => {
      const variant = target.getValue();
      // 根据按钮样式自动调整其他属性
      if (variant === 'primary') {
        target.parent.setPropValue('background.color', '#1677ff');
        target.parent.setPropValue('text.color', '#ffffff');
      } else {
        target.parent.setPropValue('background.color', '#ffffff');
        target.parent.setPropValue('text.color', '#000000');
      }
    }
  }
}
```

通过合理组合这些特性，可以构建出功能强大、交互友好的设置器配置。

## 下一步

- 了解更多[设置器配置选项](/api/setter-api)
- 探索[高级设置器开发](/guide/advanced-setter)
- 查看[设置器最佳实践](/guide/setter-best-practices)
