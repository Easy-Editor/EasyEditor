import { AiChatButton, AiChatDialog } from '@/components/ai-chat'
import { useState } from 'react'

export const AIChat = () => {
  const [isAiChatOpen, setIsAiChatOpen] = useState(false)

  const handleOpenAiChat = () => {
    setIsAiChatOpen(true)
  }

  const handleCloseAiChat = () => {
    setIsAiChatOpen(false)
  }

  return (
    <>
      {/* AI聊天按钮 - 只在聊天对话框关闭时显示 */}
      {!isAiChatOpen && <AiChatButton onClick={handleOpenAiChat} />}

      {/* AI聊天对话框 - 覆盖在SettingSidebar上方 */}
      <AiChatDialog isOpen={isAiChatOpen} onClose={handleCloseAiChat} />
    </>
  )
}
