import type { DashboardAgentMessageInput, DashboardAgentRequestOptions, DashboardAgentResult } from '@/editor/agent'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AgentRequestSlot } from './agent-request-slot.mjs'

interface Message extends DashboardAgentMessageInput {
  id: string
  createdAt: Date
}

interface CustomChatConfig {
  initialMessages: Message[]
  requestAgent: (
    messages: readonly DashboardAgentMessageInput[],
    options?: DashboardAgentRequestOptions,
  ) => Promise<DashboardAgentResult>
  onFinish?: (result: DashboardAgentResult, message: Message) => Promise<void> | void
  onError: (error: Error) => void
}

const hasUnknownOutcome = (error: Error): boolean =>
  Object.hasOwn(error, 'outcome') && (error as Error & { readonly outcome?: unknown }).outcome === 'unknown'

export const useCustomChat = (config: CustomChatConfig) => {
  const [messages, setMessages] = useState<Message[]>(config.initialMessages)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const requestSlotRef = useRef<AgentRequestSlot | undefined>(undefined)
  if (!requestSlotRef.current) requestSlotRef.current = new AgentRequestSlot()

  const cancelRequest = useCallback(() => {
    requestSlotRef.current?.cancel()
  }, [])

  useEffect(() => cancelRequest, [cancelRequest])

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value)
  }, [])

  const handleSubmit = useCallback(async () => {
    const content = input.trim()
    if (!content || isLoading) return

    const controller = requestSlotRef.current?.begin()
    if (!controller) return

    const userMessage: Message = {
      id: `${Date.now()}-user`,
      content,
      role: 'user',
      createdAt: new Date(),
    }

    setInput('')
    setIsLoading(true)
    setError(null)
    setMessages(previous => [...previous, userMessage])

    try {
      const result = await config.requestAgent([...messages, userMessage], { signal: controller.signal })
      const assistantMessage: Message = {
        id: `${Date.now()}-assistant`,
        content: result.message.content,
        role: 'assistant',
        createdAt: new Date(),
      }

      setMessages(previous => [...previous, assistantMessage])
      await config.onFinish?.(result, assistantMessage)
    } catch (caught) {
      const requestError = caught instanceof Error ? caught : new Error('Unknown Agent error')
      if (controller.signal.aborted && !hasUnknownOutcome(requestError)) return
      setError(requestError)
      config.onError(requestError)
    } finally {
      if (requestSlotRef.current?.release(controller)) setIsLoading(false)
    }
  }, [config, input, isLoading, messages])

  return {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    cancelRequest,
    isLoading,
    error,
  }
}
