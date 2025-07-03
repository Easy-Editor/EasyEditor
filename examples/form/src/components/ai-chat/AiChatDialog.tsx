import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { Bot, ChevronDown, ChevronUp, Lightbulb, Send, User, X } from 'lucide-react'
import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { categorizedSuggestions, quickSuggestions, systemPrompt } from './prompt'
import { useCustomChat } from './use-custom-chat'
import { executeAiOperations, filterMessageContent } from './utils'

interface Suggestion {
  id: string
  text: string
  category: string
  description?: string
}

interface AiChatDialogProps {
  isOpen: boolean
  onClose: () => void
  className?: string
}

export const AiChatDialog: React.FC<AiChatDialogProps> = ({ isOpen, onClose, className }) => {
  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useCustomChat({
    api: 'https://api.deerapi.com/v1/chat/completions',
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_DEER_API_KEY}`,
    },
    body: {
      model: 'gpt-4o',
    },
    initialMessages: [
      {
        id: '0',
        role: 'system',
        content: systemPrompt,
        createdAt: new Date(),
      },
      {
        id: '1',
        role: 'assistant',
        content:
          '你好！我是 EasyEditor 智能助手 🤖\n\n我可以帮助你：\n📱 生成各种页面布局\n📊 配置图表和数据展示\n🎨 设计组件样式\n⚙️ 设置数据源和接口\n\n请告诉我你想要创建什么样的页面或功能，我会为你提供详细的配置方案！',
        createdAt: new Date(),
      },
    ],
    onFinish(message) {
      console.log('✅ Custom onFinish triggered - message:', message)
      // 执行 AI 返回的配置操作
      executeAiOperations(message.content)
    },
    onError(error) {
      console.error('❌ Custom chat error:', error)
    },
  })

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 动画卸载控制
  const [isVisible, setIsVisible] = useState(isOpen)
  const [shouldShow, setShouldShow] = useState(false)

  // 建议功能状态
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isSuggestionsCollapsed, setIsSuggestionsCollapsed] = useState(true)

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

  // 点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
    }

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isDropdownOpen])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleEscape = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (isDropdownOpen) {
        setIsDropdownOpen(false)
      } else {
        onClose()
      }
    }
  }

  const handleSuggestionClick = (suggestion: Suggestion) => {
    // 设置输入框内容
    const event = {
      target: { value: suggestion.text },
    } as React.ChangeEvent<HTMLTextAreaElement>
    handleInputChange(event)

    // 关闭下拉框
    setIsDropdownOpen(false)

    // 聚焦到输入框
    textareaRef.current?.focus()
  }

  const handleDropdownToggle = () => {
    setIsDropdownOpen(!isDropdownOpen)
  }

  const handleSuggestionsToggle = () => {
    setIsSuggestionsCollapsed(!isSuggestionsCollapsed)
    // 关闭下拉框当折叠建议区域时
    if (!isSuggestionsCollapsed) {
      setIsDropdownOpen(false)
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
              <h3 className='font-medium text-sm'>EasyEditor 小助手</h3>
              <p className='text-xs text-muted-foreground'>帮助你快速生成页面</p>
            </div>
          </div>
          <Button variant='ghost' size='icon' onClick={onClose} className='h-8 w-8' aria-label='关闭AI助手'>
            <X className='h-4 w-4' />
          </Button>
        </div>

        {/* 消息列表 */}
        <ScrollArea className='flex-1 p-4'>
          <div className='space-y-4'>
            {/* 错误信息显示 */}
            {error && (
              <div className='bg-destructive/10 border border-destructive/20 rounded-lg p-3'>
                <p className='text-destructive text-sm font-medium'>聊天错误</p>
                <p className='text-destructive/80 text-xs mt-1'>{error.message}</p>
              </div>
            )}

            {messages
              .filter(message => message.role !== 'system')
              .map(message => (
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
                    <p className='whitespace-pre-wrap'>
                      {message.role === 'assistant' ? filterMessageContent(message.content) : message.content}
                    </p>
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
                <div className='bg-muted rounded-lg px-3 py-2 text-sm flex items-center justify-center'>
                  <div className='flex space-x-1'>
                    <div className='w-1 h-1 bg-current rounded-full animate-bounce' />
                    <div
                      className='w-1 h-1 bg-current rounded-full animate-bounce'
                      style={{ animationDelay: '0.1s' }}
                    />
                    <div
                      className='w-1 h-1 bg-current rounded-full animate-bounce'
                      style={{ animationDelay: '0.2s' }}
                    />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* 建议区域 */}
        <div className='border-t border-border'>
          {/* 建议区域切换按钮 */}
          <div className='px-4 py-2 border-b border-border'>
            <Button
              variant='ghost'
              size='sm'
              className='w-full justify-between h-8 text-xs hover:bg-muted'
              onClick={handleSuggestionsToggle}
              disabled={isLoading}
              aria-expanded={!isSuggestionsCollapsed}
              aria-label={isSuggestionsCollapsed ? '显示建议' : '隐藏建议'}
            >
              <div className='flex items-center gap-2'>
                <Lightbulb className='h-3 w-3' />
                <span>{isSuggestionsCollapsed ? '显示建议' : '隐藏建议'}</span>
              </div>
              {isSuggestionsCollapsed ? <ChevronUp className='h-3 w-3' /> : <ChevronDown className='h-3 w-3' />}
            </Button>
          </div>

          {/* 可折叠的建议内容 */}
          <div
            className={cn(
              'overflow-hidden transition-all duration-300 ease-in-out',
              isSuggestionsCollapsed ? 'max-h-0' : 'max-h-[400px]',
            )}
          >
            <div className='p-4 space-y-3'>
              {/* 快速建议 */}
              <div className='space-y-2'>
                <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                  <span>快速开始</span>
                </div>
                <div className='flex flex-wrap gap-2'>
                  {quickSuggestions.map(suggestion => (
                    <Button
                      key={suggestion.id}
                      variant='outline'
                      size='sm'
                      className='h-7 text-xs px-2 py-1 rounded-full hover:bg-primary hover:text-primary-foreground transition-colors'
                      onClick={() => handleSuggestionClick(suggestion)}
                      disabled={isLoading}
                    >
                      {suggestion.text}
                    </Button>
                  ))}
                </div>
              </div>

              {/* 更多建议下拉框 */}
              <div className='relative' ref={dropdownRef}>
                <Button
                  variant='ghost'
                  size='sm'
                  className='w-full justify-between h-8 text-xs'
                  onClick={handleDropdownToggle}
                  disabled={isLoading}
                  aria-expanded={isDropdownOpen}
                  aria-label='更多建议'
                >
                  <span>更多建议</span>
                  {isDropdownOpen ? <ChevronUp className='h-3 w-3' /> : <ChevronDown className='h-3 w-3' />}
                </Button>

                {/* 下拉内容 */}
                {isDropdownOpen && (
                  <div className='absolute bottom-full left-0 right-0 mb-2 bg-background border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto z-10'>
                    {Object.entries(categorizedSuggestions).map(([category, suggestions]) => (
                      <div key={category} className='p-2'>
                        <div className='text-xs font-medium text-muted-foreground mb-2 px-2'>{category}</div>
                        <div className='space-y-1'>
                          {suggestions.map(suggestion => (
                            <Button
                              key={suggestion.id}
                              variant='ghost'
                              size='sm'
                              className='w-full justify-start h-8 text-xs px-2 hover:bg-muted'
                              onClick={() => handleSuggestionClick(suggestion)}
                            >
                              {suggestion.text}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 输入区域 */}
        <div className='p-4 border-t border-border'>
          <div className='flex gap-2'>
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder='输入你的需求，或点击上方建议快速开始...'
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
