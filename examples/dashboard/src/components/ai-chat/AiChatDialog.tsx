import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { Bot, Send, User, X } from 'lucide-react'
import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'

interface Message {
  id: string
  content: string
  role: 'user' | 'assistant'
  timestamp: Date
}

interface AiChatDialogProps {
  isOpen: boolean
  onClose: () => void
  className?: string
}

export const AiChatDialog: React.FC<AiChatDialogProps> = ({ isOpen, onClose, className }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      content: '你好！我是AI助手，专门帮助你进行低代码页面的生成和编辑。有什么我可以帮助你的吗？',
      role: 'assistant',
      timestamp: new Date(),
    },
  ])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // 动画卸载控制
  const [isVisible, setIsVisible] = useState(isOpen)
  const [shouldShow, setShouldShow] = useState(false)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

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

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      content: inputValue.trim(),
      role: 'user',
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setIsLoading(true)

    // 模拟AI响应 - 这里后续可以替换为真实的AI API调用
    setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        content: `我理解你想要${userMessage.content}。作为专门用于低代码页面生成和编辑的AI助手，我可以帮你：\n\n1. 生成页面布局\n2. 创建组件结构\n3. 优化页面设计\n4. 修改现有组件\n\n请告诉我更具体的需求，我会为你提供详细的实现方案。`,
        role: 'assistant',
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, aiResponse])
      setIsLoading(false)
    }, 1000)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
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
                    {message.timestamp.toLocaleTimeString([], {
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
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='输入你的需求，比如：帮我生成一个用户管理页面...'
              className='min-h-[44px] max-h-32 resize-none flex-1'
              disabled={isLoading}
            />
            <Button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isLoading}
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
