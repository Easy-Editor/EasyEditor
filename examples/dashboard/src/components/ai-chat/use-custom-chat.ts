import type {
  DashboardAgentMessageInput,
  DashboardAgentProposal,
  DashboardAgentRequestOptions,
  DashboardAgentResult,
} from '@/editor/agent'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AgentPlanConfirmationSlot } from './agent-plan-confirmation.mjs'
import { AgentRequestSlot } from './agent-request-slot.mjs'

interface Message extends DashboardAgentMessageInput {
  id: string
  createdAt: Date
}

interface CustomChatConfig {
  initialMessages: Message[]
  requestAgent: (
    messages: readonly DashboardAgentMessageInput[],
    options: DashboardAgentRequestOptions,
  ) => Promise<DashboardAgentResult>
  onFinish?: (result: DashboardAgentResult, message: Message) => Promise<void> | void
  onError: (error: Error) => void
}

const hasUnknownOutcome = (error: Error): boolean =>
  Object.hasOwn(error, 'outcome') && (error as Error & { readonly outcome?: unknown }).outcome === 'unknown'

const hasErrorCode = (error: Error, code: string): boolean =>
  Object.hasOwn(error, 'code') && (error as Error & { readonly code?: unknown }).code === code

type AgentRequestPhase = 'idle' | 'requesting' | 'awaiting_confirmation' | 'executing'

export const useCustomChat = (config: CustomChatConfig) => {
  const [messages, setMessages] = useState<Message[]>(config.initialMessages)
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<AgentRequestPhase>('idle')
  const [pendingProposal, setPendingProposal] = useState<DashboardAgentProposal | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const requestSlotRef = useRef<AgentRequestSlot | undefined>(undefined)
  if (!requestSlotRef.current) requestSlotRef.current = new AgentRequestSlot()
  const confirmationSlotRef = useRef<AgentPlanConfirmationSlot | undefined>(undefined)
  if (!confirmationSlotRef.current) confirmationSlotRef.current = new AgentPlanConfirmationSlot()

  const isLoading = phase !== 'idle'

  const cancelRequest = useCallback(() => {
    confirmationSlotRef.current?.cancel()
    requestSlotRef.current?.cancel()
  }, [])

  useEffect(() => cancelRequest, [cancelRequest])

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value)
  }, [])

  const requestConfirmation = useCallback(
    async (proposal: DashboardAgentProposal, options: { readonly signal: AbortSignal }): Promise<boolean> => {
      setPendingProposal(proposal)
      setPhase('awaiting_confirmation')
      try {
        const confirmed = await confirmationSlotRef.current!.request(proposal.proposalId, options.signal)
        if (confirmed) setPhase('executing')
        return confirmed
      } finally {
        setPendingProposal(current => (current?.proposalId === proposal.proposalId ? null : current))
      }
    },
    [],
  )

  const confirmPendingProposal = useCallback(() => {
    if (!pendingProposal) return false
    return confirmationSlotRef.current?.approve(pendingProposal.proposalId) ?? false
  }, [pendingProposal])

  const rejectPendingProposal = useCallback(() => {
    if (!pendingProposal) return false
    const rejected = confirmationSlotRef.current?.reject(pendingProposal.proposalId) ?? false
    if (rejected) {
      const cancelledMessage: Message = {
        id: `${Date.now()}-assistant-cancelled`,
        content: '已取消这次画布修改提案，画布未发生变化。',
        role: 'assistant',
        createdAt: new Date(),
      }
      setMessages(previous => [...previous, cancelledMessage])
    }
    return rejected
  }, [pendingProposal])

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
    setPhase('requesting')
    setError(null)
    setMessages(previous => [...previous, userMessage])

    try {
      const result = await config.requestAgent([...messages, userMessage], {
        confirmProposal: requestConfirmation,
        signal: controller.signal,
      })
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
      if (hasErrorCode(requestError, 'dashboard.agent.rejected')) return
      if (controller.signal.aborted && !hasUnknownOutcome(requestError)) return
      setError(requestError)
      config.onError(requestError)
    } finally {
      if (requestSlotRef.current?.release(controller)) setPhase('idle')
    }
  }, [config, input, isLoading, messages, requestConfirmation])

  return {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    cancelRequest,
    confirmPendingProposal,
    rejectPendingProposal,
    pendingProposal,
    phase,
    isLoading,
    error,
  }
}
