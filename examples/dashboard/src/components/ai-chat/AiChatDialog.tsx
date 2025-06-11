import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { Bot, Send, User, X } from 'lucide-react'
import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useCustomChat } from './use-custom-chat'

interface AiChatDialogProps {
  isOpen: boolean
  onClose: () => void
  className?: string
}

export const AiChatDialog: React.FC<AiChatDialogProps> = ({ isOpen, onClose, className }) => {
  // TODO
  // const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
  //   api: 'https://api.deerapi.com/v1/chat/completions',
  //   headers: {
  //     Authorization: '',
  //     'Content-Type': 'application/json',
  //   },
  //   body: {
  //     model: 'gpt-4o',
  //     stream: true,
  //   },
  //   initialMessages: [
  //     {
  //       id: '1',
  //       role: 'assistant',
  //       content: '你好！我是AI助手，专门帮助你进行低代码页面的生成和编辑。有什么我可以帮助你的吗？',
  //       createdAt: new Date(),
  //     },
  //   ],
  //   onFinish(message, options) {
  //     console.log('✅ onFinish triggered - message:', message)
  //     console.log('✅ onFinish triggered - options:', options)
  //   },
  //   onError(error) {
  //     console.error('❌ Chat error:', error)
  //   },
  //   onResponse(response) {
  //     console.log('📡 Response received:', response.status, response.statusText)
  //     console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()))
  //   },
  // })
  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useCustomChat({
    api: 'https://api.deerapi.com/v1/chat/completions',
    headers: {
      Authorization: '',
    },
    body: {
      model: 'gpt-4o',
    },
    initialMessages: [
      {
        id: '1',
        role: 'assistant',
        content: '你好！我是AI助手，专门帮助你进行低代码页面的生成和编辑。有什么我可以帮助你的吗？',
        timestamp: new Date(),
        createdAt: new Date(),
      },
    ],
    onFinish(message) {
      console.log('✅ Custom onFinish triggered - message:', message)
    },
    onError(error) {
      console.error('❌ Custom chat error:', error)
    },
  })

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // 动画卸载控制
  const [isVisible, setIsVisible] = useState(isOpen)
  const [shouldShow, setShouldShow] = useState(false)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isLoading])

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true)
      setTimeout(() => setShouldShow(true), 10)
    } else {
      setShouldShow(false)
      const timer = setTimeout(() => setIsVisible(false), 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleEscape = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }

  if (!isVisible) return null

  return (
    <>
      {/* 聊天弹窗 */}
      <div
        className={cn(
          'fixed right-0 top-[57px] z-50 h-[calc(100vh-57px)] w-96 bg-background border-l border-border shadow-2xl transition-transform duration-300 ease-in-out rounded-l-2xl flex flex-col',
          shouldShow ? 'translate-x-0' : 'translate-x-full',
          className,
        )}
        onKeyDown={handleEscape}
        aria-modal='true'
      >
        {/* 聊天头部 */}
        <div className='flex items-center justify-between p-4 border-b border-border'>
          <div className='flex items-center gap-3'>
            <Avatar className='h-8 w-8'>
              <AvatarFallback className='bg-primary text-primary-foreground'>
                <Bot className='h-4 w-4' />
              </AvatarFallback>
            </Avatar>
            <div>
              <h3 className='font-medium text-sm'>AI 助手</h3>
              <p className='text-xs text-muted-foreground'>低代码页面生成专家</p>
            </div>
          </div>
          <Button variant='ghost' size='icon' onClick={onClose} className='h-8 w-8' aria-label='关闭AI助手'>
            <X className='h-4 w-4' />
          </Button>
        </div>

        {/* 消息列表 */}
        <ScrollArea className='flex-1 p-4 h-[calc(100vh-200px)]'>
          <div className='space-y-4'>
            {/* 错误信息显示 */}
            {error && (
              <div className='bg-destructive/10 border border-destructive/20 rounded-lg p-3'>
                <p className='text-destructive text-sm font-medium'>聊天错误</p>
                <p className='text-destructive/80 text-xs mt-1'>{error.message}</p>
              </div>
            )}

            {messages.map(message => (
              <div
                key={message.id}
                className={cn('flex gap-3', message.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                {message.role === 'assistant' && (
                  <Avatar className='h-8 w-8 flex-shrink-0'>
                    <AvatarFallback className='bg-muted'>
                      <Bot className='h-4 w-4' />
                    </AvatarFallback>
                  </Avatar>
                )}

                <div
                  className={cn(
                    'max-w-[280px] rounded-lg px-3 py-2 text-sm',
                    message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
                  )}
                >
                  <p className='whitespace-pre-wrap'>{message.content}</p>
                  <span className='text-xs opacity-70 mt-1 block'>
                    {message.createdAt?.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                {message.role === 'user' && (
                  <Avatar className='h-8 w-8 flex-shrink-0'>
                    <AvatarFallback className='bg-secondary'>
                      <User className='h-4 w-4' />
                    </AvatarFallback>
                  </Avatar>
                )}
              </div>
            ))}

            {isLoading && (
              <div className='flex gap-3 justify-start'>
                <Avatar className='h-8 w-8 flex-shrink-0'>
                  <AvatarFallback className='bg-muted'>
                    <Bot className='h-4 w-4' />
                  </AvatarFallback>
                </Avatar>
                <div className='bg-muted rounded-lg px-3 py-2 text-sm'>
                  <div className='flex space-x-1'>
                    <div className='w-2 h-2 bg-current rounded-full animate-bounce' />
                    <div
                      className='w-2 h-2 bg-current rounded-full animate-bounce'
                      style={{ animationDelay: '0.1s' }}
                    />
                    <div
                      className='w-2 h-2 bg-current rounded-full animate-bounce'
                      style={{ animationDelay: '0.2s' }}
                    />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* 输入区域 */}
        <div className='p-4 border-t border-border'>
          <div className='flex gap-2'>
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder='输入你的需求，比如：帮我生成一个用户管理页面...'
              className='min-h-[44px] max-h-32 resize-none flex-1'
              disabled={isLoading}
            />
            <Button
              onClick={handleSubmit}
              disabled={!input.trim() || isLoading}
              size='icon'
              className='h-11 w-11 flex-shrink-0'
              aria-label='发送消息'
            >
              <Send className='h-4 w-4' />
            </Button>
          </div>
          <p className='text-xs text-muted-foreground mt-2'>按 Enter 发送，Shift + Enter 换行，ESC 关闭</p>
        </div>
      </div>
    </>
  )
}
