/**
 * Remote Materials Panel
 * 远程物料管理面板
 */

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { materialManager, remoteMaterialsConfig, RemoteLoadError } from '@/editor/remote'
import { useState } from 'react'
import { toast } from 'sonner'

export const RemoteMaterialsPanel = () => {
  const [materials, setMaterials] = useState(remoteMaterialsConfig)
  const [loading, setLoading] = useState(false)

  const handleToggle = (index: number) => {
    const newMaterials = [...materials]
    newMaterials[index].enabled = !newMaterials[index].enabled
    setMaterials(newMaterials)
  }

  const handleLoadAll = async () => {
    setLoading(true)
    try {
      const result = await materialManager.loadMaterialMultiple(materials.filter(m => m.enabled))

      if (result.succeeded > 0) {
        toast.success(`成功加载 ${result.succeeded} 个远程物料`, {
          description: result.failed > 0 ? `失败: ${result.failed} 个` : undefined,
        })
      } else {
        toast.error('所有物料加载失败')
      }

      // 显示详细错误信息
      result.results.forEach((r, i) => {
        if (r.status === 'rejected') {
          const material = materials.filter(m => m.enabled)[i]
          const error = r.reason

          if (error instanceof RemoteLoadError) {
            toast.error(`${material.package} 加载失败`, {
              description: error.toUserMessage(),
            })
          } else {
            toast.error(`${material.package} 加载失败`, {
              description: error instanceof Error ? error.message : String(error),
            })
          }
        }
      })
    } catch (error) {
      if (error instanceof RemoteLoadError) {
        toast.error('加载失败', {
          description: error.toUserMessage(),
        })
      } else {
        toast.error('加载失败', {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    } finally {
      setLoading(false)
    }
  }

  const handleAddMaterial = () => {
    setMaterials([
      ...materials,
      {
        package: '',
        version: 'latest',
        globalName: '',
        enabled: true,
      },
    ])
  }

  const handleRemove = (index: number) => {
    const newMaterials = materials.filter((_, i) => i !== index)
    setMaterials(newMaterials)
  }

  const handleChange = (index: number, field: keyof (typeof materials)[0], value: string | boolean) => {
    const newMaterials = [...materials]
    newMaterials[index] = { ...newMaterials[index], [field]: value }
    setMaterials(newMaterials)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>远程物料管理</CardTitle>
        <CardDescription>从 NPM/CDN 动态加载物料组件</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {materials.map((material, index) => (
          <div key={index} className='flex items-end gap-2 p-3 border rounded-lg'>
            <div className='flex-1 space-y-2'>
              <div>
                <Label htmlFor={`package-${index}`}>Package Name</Label>
                <Input
                  id={`package-${index}`}
                  placeholder='@easy-editor/materials-dashboard-text'
                  value={material.package}
                  onChange={e => handleChange(index, 'package', e.target.value)}
                />
              </div>
              <div className='grid grid-cols-2 gap-2'>
                <div>
                  <Label htmlFor={`version-${index}`}>Version</Label>
                  <Input
                    id={`version-${index}`}
                    placeholder='latest'
                    value={material.version}
                    onChange={e => handleChange(index, 'version', e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor={`globalName-${index}`}>Global Name</Label>
                  <Input
                    id={`globalName-${index}`}
                    placeholder='Text'
                    value={material.globalName}
                    onChange={e => handleChange(index, 'globalName', e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className='flex items-center gap-2'>
              <Switch checked={material.enabled} onCheckedChange={() => handleToggle(index)} />
              <Button variant='outline' size='sm' onClick={() => handleRemove(index)}>
                删除
              </Button>
            </div>
          </div>
        ))}

        <div className='flex gap-2'>
          <Button variant='outline' onClick={handleAddMaterial}>
            添加物料
          </Button>
          <Button onClick={handleLoadAll} disabled={loading}>
            {loading ? '加载中...' : '加载全部'}
          </Button>
        </div>

        <div className='pt-4 border-t'>
          <h4 className='mb-2 text-sm font-semibold'>已加载的远程物料：</h4>
          <div className='space-y-1'>
            {materialManager.getLoadedMaterials().map(m => (
              <div key={m.name} className='text-sm text-muted-foreground'>
                {m.name} - {m.metadata.title || m.metadata.componentName}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
