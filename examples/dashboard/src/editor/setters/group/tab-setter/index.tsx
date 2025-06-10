import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { SetterProps } from '@easy-editor/core'
import type { PropsWithChildren } from 'react'
import React from 'react'

interface TabSetterProps extends SetterProps<string>, PropsWithChildren {
  tabs?: {
    label: string
    value: string
  }[]
}

const TabSetter = (props: TabSetterProps) => {
  const { tabs, initialValue, children } = props

  const tabsList = React.useMemo(() => {
    if (tabs) return tabs
    if (Array.isArray(children) && children.length > 0) {
      return children.map(child => ({
        label: child.props.field.config.title,
        value: child.props.field.config.key,
      }))
    }
    throw new Error('TabSetter: children or tabs must be an array')
  }, [tabs, children])
  const firstTabValue = React.useMemo(() => tabsList[0]?.value, [tabsList])

  return (
    <Tabs defaultValue={initialValue ?? firstTabValue} className='w-full'>
      <TabsList
        className='grid w-full'
        style={{
          gridTemplateColumns: `repeat(${tabsList.length}, minmax(0, 1fr))`,
        }}
      >
        {tabsList.map(tab => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {/* INFO：两种 group 的渲染方式，一种是 field.items，一种是 children */}
      {/* {field.items?.map(item => (
        <TabsContent key={item.config.key} value={item.config.key as string} className='box-border p-4 mt-0'>
          {item.items?.map(item => (
            <SettingFieldView key={item.name} field={item} />
          ))}
        </TabsContent>
      ))} */}
      {Array.isArray(children) &&
        children.map(child => (
          <TabsContent
            key={child.props.field.config.key}
            value={child.props.field.config.key}
            className='box-border p-2 mt-0 space-y-3'
          >
            {child}
          </TabsContent>
        ))}
    </Tabs>
  )
}

export default TabSetter
