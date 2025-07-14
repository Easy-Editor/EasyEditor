import type { Setters, SettingField } from '@easy-editor/core'
import type { SettingRendererProps } from '@easy-editor/renderer-core'
import { observer } from 'mobx-react'
import { useMemo } from 'react'
import { SettingSetter } from './SettingSetter'
import { SettingRendererContext, useSettingRendererContext } from './context'

interface SettingFieldProps {
  field: SettingField
}

const SettingFieldItem = observer<React.FC<SettingFieldProps>>(({ field }) => {
  const { customFieldItem } = useSettingRendererContext()

  if (customFieldItem) {
    return customFieldItem(field, <SettingSetter field={field} />)
  }

  return (
    <div className='space-y-2'>
      <label htmlFor={field.id} className='block text-sm font-medium text-gray-700'>
        {field.title}
      </label>
      <SettingSetter field={field} />
    </div>
  )
})

const SettingFieldGroup = observer<React.FC<SettingFieldProps>>(({ field }) => {
  const { customFieldGroup } = useSettingRendererContext()

  if (customFieldGroup) {
    return customFieldGroup(
      field,
      <SettingSetter field={field}>
        {field.items?.map(item => (
          <SettingFieldView key={item.id} field={item} />
        ))}
      </SettingSetter>,
    )
  }

  // 如果 field 没有 setter，则理解为其 父级 field 的 items 数据
  if (!field.setter) {
    return field.items?.map(item => <SettingFieldView key={item.id} field={item} />)
  }

  return (
    <SettingSetter field={field}>
      {field.items?.map(item => (
        <SettingFieldView key={item.id} field={item} />
      ))}
    </SettingSetter>
  )
})

export const SettingFieldView: React.FC<SettingFieldProps> = ({ field }) => {
  if (field.isGroup) {
    return <SettingFieldGroup field={field} key={field.id} />
  } else {
    return <SettingFieldItem field={field} key={field.id} />
  }
}

export const SettingRenderer = observer<React.FC<SettingRendererProps>>(props => {
  const { designer, customFieldItem, customFieldGroup } = props
  const setters = designer.editor.get<Setters>('setters')!
  const { settingsManager } = designer
  const { settings } = settingsManager
  const items = settings?.items
  console.log('🚀 ~ items:', items)

  const ctx = useMemo(() => {
    const ctx = {} as SettingRendererContext
    ctx.setters = setters
    ctx.settingsManager = settingsManager
    ctx.customFieldItem = customFieldItem
    ctx.customFieldGroup = customFieldGroup

    return ctx
  }, [setters, settingsManager, customFieldItem, customFieldGroup])

  if (!settings) {
    // 未选中节点，提示选中 或者 显示根节点设置
    return (
      <div className='lc-settings-main'>
        <div className='lc-settings-notice'>
          <p>Please select a node in canvas</p>
        </div>
      </div>
    )
  }

  // 当节点被锁定，且未开启锁定后容器可设置属性
  if (settings.isLocked) {
    return (
      <div className='lc-settings-main'>
        <div className='lc-settings-notice'>
          <p>Current node is locked</p>
        </div>
      </div>
    )
  }
  if (Array.isArray(settings.items) && settings.items.length === 0) {
    return (
      <div className='lc-settings-main'>
        <div className='lc-settings-notice'>
          <p>No config found for this type of component</p>
        </div>
      </div>
    )
  }

  if (!settings.isSameComponent) {
    // TODO: future support 获取设置项交集编辑
    return (
      <div className='lc-settings-main'>
        <div className='lc-settings-notice'>
          <p>Please select same kind of components</p>
        </div>
      </div>
    )
  }

  return (
    <SettingRendererContext.Provider value={ctx}>
      {items?.map(item => (
        <SettingFieldView key={item.id} field={item} />
      ))}
    </SettingRendererContext.Provider>
  )
})
