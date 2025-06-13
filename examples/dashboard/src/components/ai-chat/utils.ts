import { type Document, type NodeSchema, project } from '@easy-editor/core'

// AI 操作类型
interface AiOperation {
  type: 'add' | 'update' | 'replace' | 'remove' | 'batch' | 'move' | 'wrap' | 'unwrap' | 'insertBefore' | 'insertAfter'
  payload: any
}

// 具体的 payload 类型
interface AddPayload extends NodeSchema {
  targetId?: string
  position?: number
}

interface UpdatePayload {
  id: string
  fields: Record<string, any>
}

interface RemovePayload {
  id: string
}

interface BatchPayload extends Array<AiOperation> {}

// 解析 AI 返回的 JSON 配置并执行操作
export const executeAiOperations = (content: string) => {
  try {
    console.log('🔍 Parsing AI response:', content)

    // 尝试提取 JSON 内容
    let jsonContent = content

    // 如果内容包含 JSON 代码块，提取其中的 JSON
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i)
    if (jsonMatch) {
      jsonContent = jsonMatch[1]
    } else {
      // 尝试寻找纯 JSON 对象
      const jsonObjectMatch = content.match(/\{[\s\S]*\}/)
      if (jsonObjectMatch) {
        jsonContent = jsonObjectMatch[0]
      }
    }

    const operation: AiOperation = JSON.parse(jsonContent)
    const currentDocument = project.currentDocument

    if (!currentDocument) {
      console.warn('⚠️ No current document available')
      return
    }

    console.log('🎯 Executing AI operation:', operation)

    executeOperation(operation, currentDocument)

    // 保存历史记录
    currentDocument.history.savePoint()
  } catch (error) {
    console.error('❌ Failed to parse or execute AI operations:', error)
    console.log('Raw content:', content)
  }
}

const executeOperation = (operation: AiOperation, document: Document) => {
  const { type, payload } = operation

  switch (type) {
    case 'add': {
      const addPayload = payload as AddPayload
      const { targetId, position, ...nodeSchema } = addPayload

      if (targetId) {
        const targetNode = document.getNode(targetId)
        if (targetNode) {
          document.insertNode(targetNode, nodeSchema, position)
          console.log('✅ Added node to target:', targetId)
        } else {
          console.warn('⚠️ Target node not found:', targetId)
        }
      } else {
        // 添加到根节点
        const rootNode = document.getRoot()
        if (rootNode) {
          document.insertNode(rootNode, nodeSchema, position)
          console.log('✅ Added node to root')
        }
      }
      break
    }

    case 'update': {
      const updatePayload = payload as UpdatePayload
      const { id, fields } = updatePayload

      const node = document.getNode(id)
      if (node) {
        Object.entries(fields).forEach(([key, value]) => {
          if (key === '$dashboard') {
            node.setExtraPropValue(key, value)
          } else {
            node.setPropValue(key, value)
          }
        })
        console.log('✅ Updated node props:', id)
      } else {
        console.warn('⚠️ Node not found for update:', id)
      }
      break
    }

    case 'replace': {
      const replacePayload = payload as NodeSchema & { id: string }
      const { id, ...nodeSchema } = replacePayload

      const node = document.getNode(id)
      if (node) {
        node.replaceWith(nodeSchema)
        console.log('✅ Replaced node:', id)
      } else {
        console.warn('⚠️ Node not found for replace:', id)
      }
      break
    }

    case 'remove': {
      const removePayload = payload as RemovePayload
      const { id } = removePayload

      const node = document.getNode(id)
      if (node) {
        node.remove()
        console.log('✅ Removed node:', id)
      } else {
        console.warn('⚠️ Node not found for remove:', id)
      }
      break
    }

    case 'batch': {
      const batchPayload = payload as BatchPayload

      batchPayload.forEach((op, index) => {
        console.log(`🚀 Executing batch operation ${index + 1}:`, op)
        executeOperation(op, document)
      })
      console.log('✅ Batch operations completed:', batchPayload.length)
      break
    }

    case 'insertBefore': {
      const insertPayload = payload as NodeSchema & { referenceId: string }
      const { referenceId, ...nodeSchema } = insertPayload

      const referenceNode = document.getNode(referenceId)
      if (referenceNode && referenceNode.parent) {
        const newNode = document.createNode(nodeSchema)
        referenceNode.parent.insertBefore(newNode, referenceNode)
        console.log('✅ Inserted node before:', referenceId)
      } else {
        console.warn('⚠️ Reference node not found for insertBefore:', referenceId)
      }
      break
    }

    case 'insertAfter': {
      const insertPayload = payload as NodeSchema & { referenceId: string }
      const { referenceId, ...nodeSchema } = insertPayload

      const referenceNode = document.getNode(referenceId)
      if (referenceNode && referenceNode.parent) {
        const newNode = document.createNode(nodeSchema)
        referenceNode.parent.insertAfter(newNode, referenceNode)
        console.log('✅ Inserted node after:', referenceId)
      } else {
        console.warn('⚠️ Reference node not found for insertAfter:', referenceId)
      }
      break
    }

    default:
      console.warn('⚠️ Unknown operation:', type)
  }
}

// 过滤消息内容，移除 JSON 代码只保留文字
export const filterMessageContent = (content: string): string => {
  let filteredContent = content

  // 移除 JSON 代码块 ```json ... ``` 或 ``` ... ```
  filteredContent = filteredContent.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/gi, '')

  // 移除独立的 JSON 对象（以 { 开始，以 } 结束的完整行）
  filteredContent = filteredContent.replace(/^\s*\{[\s\S]*?\}\s*$/gm, '')

  // 移除多余的空行，保持最多两个连续的换行
  filteredContent = filteredContent.replace(/\n{3,}/g, '\n\n')

  // 移除开头和结尾的空白字符
  filteredContent = filteredContent.trim()

  return filteredContent
}
