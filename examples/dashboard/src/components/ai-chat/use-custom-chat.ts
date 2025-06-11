import { useCallback, useState } from 'react'

interface Message {
  id: string
  content: string
  role: 'user' | 'assistant'
  timestamp: Date
  createdAt?: Date
}

// 自定义聊天Hook作为备选方案
export const useCustomChat = (config: {
  api: string
  headers: Record<string, string>
  body: Record<string, any>
  initialMessages: Message[]
  onFinish: (message: Message) => void
  onError: (error: Error) => void
}) => {
  const [messages, setMessages] = useState<Message[]>(config.initialMessages)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      content: input.trim(),
      role: 'user',
      timestamp: new Date(),
      createdAt: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)
    setError(null)

    try {
      console.log('🚀 Sending request to:', config.api)

      const response = await fetch(config.api, {
        method: 'POST',
        headers: {
          ...config.headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...config.body,
          messages: [...messages, userMessage].map(msg => ({
            role: msg.role,
            content: msg.content,
          })),
          stream: false, // 使用非流式响应确保完整性
        }),
      })

      console.log('📡 Response status:', response.status)
      console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()))

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log('📡 Response data:', data)

      const assistantMessage: Message = {
        id: data.id || Date.now().toString(),
        content: data.choices[0]?.message?.content || '抱歉，我无法理解您的请求。',
        role: 'assistant',
        timestamp: new Date(),
        createdAt: new Date(),
      }

      setMessages(prev => [...prev, assistantMessage])

      // 确保调用 onFinish
      console.log('✅ Calling onFinish with message:', assistantMessage)
      config.onFinish(assistantMessage)
    } catch (err) {
      console.error('❌ Chat error:', err)
      const error = err instanceof Error ? err : new Error('Unknown error')
      setError(error)
      config.onError(error)
    } finally {
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
