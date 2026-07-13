import type { DashboardAgentContext } from '@/editor/agent'
import { useCallback, useState } from 'react'
import { createCanvasProjection, createChatRequest } from './privacy.mjs'

interface Message {
  id: string
  content: string
  role: 'user' | 'assistant' | 'system'
  createdAt: Date
}

interface CustomChatConfig {
  initialMessages: Message[]
  createAgentContext: () => DashboardAgentContext
  onFinish: (
    message: Message,
    context: DashboardAgentContext,
    nodeIdsByAlias: ReadonlyMap<string, string>,
  ) => Promise<void> | void
  onError: (error: Error) => void
}

interface ChatCompletionResponse {
  id?: string
  message?: {
    role?: 'assistant'
    content?: string
  }
}

interface GatewayErrorResponse {
  error?: {
    code?: string
    message?: string
  }
}

// 自定义聊天Hook作为备选方案
export const useCustomChat = (config: CustomChatConfig) => {
  const [messages, setMessages] = useState<Message[]>(config.initialMessages)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || isLoading) return

    let agentContext: DashboardAgentContext | undefined

    const userMessage: Message = {
      id: Date.now().toString(),
      content: input.trim(),
      role: 'user',
      createdAt: new Date(),
    }

    setInput('')
    setIsLoading(true)
    setError(null)

    try {
      // 在请求发出前固定文档身份和修订版本；响应回来后不再读取全局项目状态。
      agentContext = config.createAgentContext()
      const { snapshot } = agentContext
      const projection = createCanvasProjection(snapshot.schema)

      setMessages(prev => [...prev, userMessage])

      const conversation = messages.filter(message => message.role !== 'system')
      const request = createChatRequest([...conversation, userMessage], projection.canvas)

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      })

      if (!response.ok) {
        const gatewayError = (await response.json().catch(() => undefined)) as GatewayErrorResponse | undefined
        throw new Error(gatewayError?.error?.message || `AI request failed (${response.status})`)
      }

      const data = (await response.json()) as ChatCompletionResponse

      const assistantMessage: Message = {
        id: data.id || Date.now().toString(),
        content: data.message?.content || '抱歉，我无法理解您的请求。',
        role: 'assistant',
        createdAt: new Date(),
      }

      setMessages(prev => [...prev, assistantMessage])

      await config.onFinish(assistantMessage, agentContext, projection.nodeIdsByAlias)
    } catch (err) {
      console.error('❌ Chat error:', err)
      const error = err instanceof Error ? err : new Error('Unknown error')
      setError(error)
      config.onError(error)
    } finally {
      agentContext?.capability.close()
      setIsLoading(false)
    }
  }, [input, isLoading, messages, config])

  return {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
  }
}
