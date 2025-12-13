/**
 * Developer Tools Panel
 * 开发者工具面板 - 用于调试和管理远程物料
 */

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Settings } from 'lucide-react'
import { RemoteMaterialsPanel } from './RemoteMaterialsPanel'

export const DevTools = () => {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant='outline' size='icon' title='开发者工具'>
          <Settings className='w-4 h-4' />
        </Button>
      </SheetTrigger>
      <SheetContent side='right' className='w-[500px] overflow-y-auto'>
        <SheetHeader>
          <SheetTitle>开发者工具</SheetTitle>
          <SheetDescription>管理远程物料和调试信息</SheetDescription>
        </SheetHeader>
        <div className='mt-6'>
          <RemoteMaterialsPanel />
        </div>
      </SheetContent>
    </Sheet>
  )
}
