import { type DynamicSetterProps, type SettingField, isSetterConfig } from '@easy-editor/core'
import { observer } from 'mobx-react'
import type { PropsWithChildren, ReactNode } from 'react'
import { SetterPlaceholder } from './SetterPlaceholder'
import { useSettingRendererContext } from './context'

const getSetterInfo = (field: SettingField) => {
  const { extraProps, setter } = field
  const { defaultValue } = extraProps

  let setterProps:
    | ({
        setters?: (ReactNode | string)[]
      } & Record<string, unknown>)
    | DynamicSetterProps = {}
  let setterType: any
  let initialValue: any = null

  if (isSetterConfig(setter)) {
    setterType = setter.componentName
    if (setter.props) {
      setterProps = setter.props
      if (typeof setterProps === 'function') {
        setterProps = setterProps(field)
      }
    }
    if (setter.defaultValue != null) {
      initialValue = setter.defaultValue
    }
  } else if (setter) {
    setterType = setter
  }

  if (defaultValue != null && !('defaultValue' in setterProps)) {
    setterProps.defaultValue = defaultValue
    if (initialValue == null) {
      initialValue = defaultValue
    }
  }

  if (field.valueState === -1) {
    setterProps.multiValue = true
  }

  // 根据是否支持变量配置做相应的更改
  const supportVariable = field.extraProps?.supportVariable
  const isUseVariableSetter = supportVariable
  if (isUseVariableSetter === false) {
    return {
      setterProps,
      initialValue,
      setterType,
    }
  }

  return {
    setterProps,
    setterType,
    initialValue,
  }
}

interface SettingSetterProps extends PropsWithChildren {
  field: SettingField
}

export const SettingSetter = observer(({ field, children }: SettingSetterProps) => {
  const { setters } = useSettingRendererContext()
  const { extraProps } = field
  const visible =
    extraProps?.condition && typeof extraProps.condition === 'function' ? extraProps.condition(field) !== false : true

  if (!visible) {
    return null
  }

  const { setterProps = {}, setterType, initialValue = null } = getSetterInfo(field)
  const onChange = extraProps?.onChange
  const value = field.valueState === -1 ? null : field.getValue()
  const { component: SetterComponent, props: mixedSetterProps } = setters.createSetterContent(setterType, setterProps)

  // 处理设置器未加载的情况
  if (!SetterComponent) {
    return <SetterPlaceholder setterType={setterType} />
  }

  return (
    <SetterComponent
      key={field.id}
      field={field}
      selected={field.top?.getNode()}
      initialValue={initialValue}
      value={value}
      onChange={(newVal: any) => {
        field.setValue(newVal)
        onChange?.(field, newVal)
      }}
      onInitial={() => {
        if (initialValue == null) {
          return
        }
        const value = typeof initialValue === 'function' ? initialValue(field) : initialValue
        field.setValue(value, true)
      }}
      removeProp={() => {
        if (field.name) {
          field.parent.clearPropValue(field.name)
        }
      }}
      {...mixedSetterProps}
    >
      {children}
    </SetterComponent>
  )
})
