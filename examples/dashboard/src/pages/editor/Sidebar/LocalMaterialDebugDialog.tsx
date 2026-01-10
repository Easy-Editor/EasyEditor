/**
 * Local Material Debug Dialog
 * 本地物料调试对话框 - 用于连接本地物料开发服务器
 */

import { useState, useEffect, useCallback } from 'react'
import { observer } from 'mobx-react'
import { Plug, Unplug, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { localLoader } from '@/editor/remote'

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error'

interface ConnectionState {
  url: string
  componentName: string
}

export const LocalMaterialDebugDialog = observer(() => {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('http://localhost:5001')
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [connections, setConnections] = useState<ConnectionState[]>([])

  // 加载保存的配置
  useEffect(() => {
    const saved = localStorage.getItem('dev:material-debug-url')
    if (saved) {
      setUrl(saved)
    }
  }, [])

  // 更新连接列表
  const updateConnections = useCallback(() => {
    setConnections(localLoader.getConnections())
  }, [])

  // 监听连接事件
  useEffect(() => {
    const handleConnected = () => {
      setStatus('connected')
      updateConnections()
    }

    const handleDisconnected = () => {
      updateConnections()
      // 如果没有连接了，重置状态
      if (localLoader.getConnections().length === 0) {
        setStatus('idle')
      }
    }

    const handleError = ({ error }: { error: Error }) => {
      setStatus('error')
      setErrorMessage(error.message)
    }

    const handleHmrUpdate = () => {
      // HMR 更新时刷新连接列表
      updateConnections()
    }

    localLoader.on('connected', handleConnected)
    localLoader.on('disconnected', handleDisconnected)
    localLoader.on('error', handleError)
    localLoader.on('hmr:update', handleHmrUpdate)

    // 初始化时更新连接列表
    updateConnections()

    return () => {
      localLoader.off('connected', handleConnected)
      localLoader.off('disconnected', handleDisconnected)
      localLoader.off('error', handleError)
      localLoader.off('hmr:update', handleHmrUpdate)
    }
  }, [updateConnections])

  const handleConnect = async () => {
    if (!url.trim()) {
      setErrorMessage('Please enter a valid URL')
      setStatus('error')
      return
    }

    setStatus('connecting')
    setErrorMessage('')

    try {
      // 保存 URL
      localStorage.setItem('dev:material-debug-url', url)

      await localLoader.connect({ devServerUrl: url })
      setStatus('connected')
      // 连接成功后关闭对话框
      setTimeout(() => setOpen(false), 500)
    } catch (error) {
      setStatus('error')
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const handleDisconnect = (targetUrl: string) => {
    localLoader.disconnect(targetUrl)
  }

  const handleDisconnectAll = () => {
    localLoader.disconnectAll()
    setStatus('idle')
  }

  const handleRefresh = async (targetUrl: string) => {
    try {
      await localLoader.refresh(targetUrl)
      updateConnections()
    } catch (error) {
      console.error('Failed to refresh material:', error)
    }
  }

  const isConnected = localLoader.isConnected(url)
  const hasConnections = connections.length > 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant='outline' size='sm' className={hasConnections ? 'border-green-500 text-green-600' : ''}>
          <Plug className='mr-1 h-4 w-4' />
          {hasConnections ? `Debugging (${connections.length})` : 'Local Debug'}
        </Button>
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Local Material Debug</DialogTitle>
          <DialogDescription>Connect to a local material dev server for real-time debugging</DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          {/* 连接输入 */}
          <div className='space-y-2'>
            <Label htmlFor='devServerUrl'>Dev Server URL</Label>
            <div className='flex gap-2'>
              <Input
                id='devServerUrl'
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder='http://localhost:5001'
                disabled={status === 'connecting'}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    handleConnect()
                  }
                }}
              />
              <Button onClick={handleConnect} disabled={status === 'connecting' || isConnected} className='shrink-0'>
                {status === 'connecting' ? (
                  <RefreshCw className='h-4 w-4 animate-spin' />
                ) : (
                  <Plug className='h-4 w-4' />
                )}
              </Button>
            </div>
          </div>

          {/* 状态显示 */}
          {status === 'error' && errorMessage && (
            <div className='flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800'>
              <AlertCircle className='mt-0.5 h-4 w-4 shrink-0' />
              <span>{errorMessage}</span>
            </div>
          )}

          {status === 'connected' && !errorMessage && (
            <div className='flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800'>
              <CheckCircle className='h-4 w-4' />
              <span>Connected successfully!</span>
            </div>
          )}

          {/* 活动连接列表 */}
          {hasConnections && (
            <div className='space-y-2'>
              <Label>Active Connections</Label>
              <div className='space-y-2'>
                {connections.map(conn => (
                  <div key={conn.url} className='flex items-center justify-between rounded-md border bg-muted/50 p-2'>
                    <div className='min-w-0 flex-1'>
                      <div className='truncate text-sm font-medium'>{conn.componentName}</div>
                      <div className='truncate text-xs text-muted-foreground'>{conn.url}</div>
                    </div>
                    <div className='ml-2 flex shrink-0 gap-1'>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => handleRefresh(conn.url)}
                        title='Refresh material'
                        className='text-blue-600 hover:bg-blue-50 hover:text-blue-700'
                      >
                        <RefreshCw className='h-4 w-4' />
                      </Button>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => handleDisconnect(conn.url)}
                        title='Disconnect'
                        className='text-red-600 hover:bg-red-50 hover:text-red-700'
                      >
                        <Unplug className='h-4 w-4' />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 使用说明 */}
          <div className='rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground'>
            <p className='font-medium'>Quick Start:</p>
            <ol className='mt-1 list-inside list-decimal space-y-0.5'>
              <li>
                Run <code className='rounded bg-muted px-1'>pnpm dev</code> in your material package
              </li>
              <li>Enter the dev server URL above</li>
              <li>Click connect to start debugging</li>
            </ol>
          </div>
        </div>

        <DialogFooter>
          {hasConnections && (
            <Button variant='outline' onClick={handleDisconnectAll}>
              Disconnect All
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})

export default LocalMaterialDebugDialog
