import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SetterProps } from '@easy-editor/core'
import { Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'

export interface UploadValue {
  raw: {
    name: string
    size: number
    type: string
    width: number
    height: number
  }
  base64: string
}

interface UploadSetterProps extends SetterProps<UploadValue | null> {
  accept?: string
  maxSize?: number
}

const UploadSetter = (props: UploadSetterProps) => {
  const { value, onChange, accept = '.jpg,.jpeg,.png,.gif', maxSize = 10 * 1024 * 1024 } = props
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    setError('')

    if (!file) {
      onChange(null)
      return
    }

    // 验证文件类型
    const ext = `.${file.name.split('.').pop()?.toLowerCase()}`
    if (!accept.includes(ext)) {
      setError(`仅支持 ${accept} 格式文件`)
      onChange(null)
      return
    }

    // 验证文件大小
    if (file.size > maxSize) {
      setError(`文件大小不能超过 ${maxSize / 1024 / 1024}MB`)
      onChange(null)
      return
    }

    try {
      const [base64, dimensions] = await Promise.all([
        // 读取Base64
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = error => reject(error)
          reader.readAsDataURL(file)
        }),
        // 读取图片尺寸
        new Promise<{ width: number; height: number }>((resolve, reject) => {
          const img = new Image()
          img.onload = () =>
            resolve({
              width: img.naturalWidth,
              height: img.naturalHeight,
            })
          img.onerror = reject
          img.src = URL.createObjectURL(file)
        }),
      ])

      onChange({
        raw: {
          name: file.name,
          size: file.size,
          type: file.type,
          width: dimensions.width,
          height: dimensions.height,
        },
        base64,
      })
    } catch (error) {
      setError('文件读取失败，请重试')
      onChange(null)
    }
  }

  const handleClear = () => {
    onChange(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className='relative w-full group overflow-hidden'>
      <div className='flex gap-2'>
        <label className='flex-1 cursor-pointer'>
          <input
            ref={inputRef}
            type='file'
            accept={accept}
            onChange={handleFileChange}
            className={cn(
              'h-8 text-xs px-2 py-[5px] cursor-pointer',
              'border-dashed hover:border-primary transition-colors',
              'opacity-0 absolute w-0 h-0',
            )}
          />
          <div className='flex items-center justify-center h-8 w-full border-dashed border rounded-md text-xs text-muted-foreground hover:border-primary transition-colors'>
            <Upload className='w-4 h-4 mr-2' />
            <span>{value ? '更换文件' : '点击上传'}</span>
          </div>
        </label>

        {value && (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={handleClear}
            className='h-8 px-2 text-muted-foreground hover:text-destructive'
            aria-label='清除文件'
          >
            <X className='w-4 h-4' />
          </Button>
        )}
      </div>

      {value && (
        <div className='mt-2 flex items-center gap-2 text-xs text-foreground/80 w-full'>
          <span className='truncate flex-1 min-w-0'>{value.raw?.name}</span>
          <span className='text-muted-foreground/50 whitespace-nowrap shrink-0'>
            {(value.raw?.size / 1024).toFixed(1)}KB
          </span>
        </div>
      )}

      {error && (
        <p className='mt-1 text-xs text-destructive' role='alert'>
          {error}
        </p>
      )}
    </div>
  )
}

export default UploadSetter
