import BannerImg from '@/assets/banner.png'
import { Button } from '@/components/ui/button'
import { savePageInfoToLocalStorage, savePageSchemaToLocalStorage, saveProjectSchemaToLocalStorage } from '@/lib/schema'
import { cn } from '@/lib/utils'
import { TRANSFORM_STAGE, project } from '@easy-editor/core'
import { toast } from 'sonner'

export const AppHeader = ({ className }: { className?: string }) => {
  const save = (kind: 'project' | 'page' = 'page') => {
    if (kind === 'project') {
      saveProjectSchemaToLocalStorage(project.export(TRANSFORM_STAGE.SAVE))
    } else {
      const pageInfo = []
      for (const doc of project.documents) {
        pageInfo.push({ path: doc.fileName, title: doc.rootNode?.getExtraPropValue('fileDesc') as string })
        savePageSchemaToLocalStorage(doc.fileName, doc.export(TRANSFORM_STAGE.SAVE))
      }
      savePageInfoToLocalStorage(pageInfo)
    }
    toast.success('保存成功')
  }

  const preview = () => {
    save('page')
    window.open('/preview', '_blank')
  }

  return (
    <header
      className={cn(
        'w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
        className,
      )}
    >
      <div className='border-border/70 dark:border-border w-full border-dashed'>
        <div className='flex h-14 items-center px-4'>
          <div className='mr-4 hidden md:flex'>
            <div className='mr-4 flex items-center gap-2 lg:mr-6'>
              <img src={BannerImg} alt='banner' className='h-6' />
            </div>
            <nav className='flex items-center gap-4 text-sm xl:gap-6' />
          </div>
          <div className='flex flex-1 items-center justify-between gap-2 md:justify-end'>
            <div className='w-full flex-1 md:w-auto md:flex-none' />
            <div className='flex items-center gap-2'>
              <Button variant='outline' onClick={preview}>
                预览
              </Button>
              <Button variant='outline' onClick={() => save('page')}>
                保存
              </Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
