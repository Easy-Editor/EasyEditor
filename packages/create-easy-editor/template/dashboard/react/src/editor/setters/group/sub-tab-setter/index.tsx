import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { SetterProps } from '@easy-editor/core'
import type { PropsWithChildren } from 'react'
import React from 'react'

interface SubTabSetterProps extends SetterProps<string>, PropsWithChildren {
  tabs?: {
    label: string
    value: string
  }[]
}

const SubTabSetter = (props: SubTabSetterProps) => {
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
    <Tabs defaultValue={initialValue ?? firstTabValue} className='w-[calc(100%_+_32px)] space-y-2 -translate-x-4'>
      <TabsList className='flex w-full gap-x-6 border-b bg-transparent p-0 rounded-none'>
        {tabsList.map(tab => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className='relative -mb-px rounded-none border-b-2 border-transparent pb-2 px-1 text-muted-foreground
                     data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:bg-transparent
                     hover:text-foreground transition-colors duration-200 text-center'
            style={{
              flexBasis: `${100 / tabsList.length}%`,
            }}
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {Array.isArray(children) &&
        children.map(child => (
          <TabsContent
            key={child.props.field.config.key}
            value={child.props.field.config.key}
            className='box-border px-4 py-2 mt-0 space-y-4'
          >
            {child}
          </TabsContent>
        ))}
    </Tabs>
  )
}

export default SubTabSetter
