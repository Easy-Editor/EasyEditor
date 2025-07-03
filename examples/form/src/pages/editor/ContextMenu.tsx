import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { TRANSFORM_STAGE, insertChildren, project } from '@easy-editor/core'
import { ClipboardCopy, ClipboardPaste, ClipboardPen, Eye, Lock, Trash2 } from 'lucide-react'
import { observer } from 'mobx-react'
import { Fragment, type PropsWithChildren } from 'react'

enum SelectionType {
  NONE = 'none',
  SINGLE = 'single',
  MULTIPLE = 'multiple',
}

interface MenuItem {
  key: string
  label: string
  icon?: React.ComponentType
  separator?: boolean
  shortcut?: string
  onClick?: () => void
}

const menuItems: MenuItem[] = [
  {
    key: 'copy',
    label: '复制',
    icon: ClipboardCopy,
    shortcut: '⌘C',
    async onClick() {
      const doc = project.currentDocument
      if (!doc) {
        return
      }

      const selected = project.designer.selection.getTopNodes(false)
      if (!selected || selected.length < 1) {
        return
      }

      const componentsTree = selected.map(item => item?.export(TRANSFORM_STAGE.CLONE))
      const data = { type: 'NodeSchema', componentsMap: {}, componentsTree }

      await navigator.clipboard.writeText(JSON.stringify(data))
    },
  },
  {
    key: 'paste',
    label: '粘贴',
    icon: ClipboardPaste,
    shortcut: '⌘V',
    async onClick() {
      const doc = project.currentDocument
      const selection = project.designer.selection
      if (!doc) {
        return
      }

      const data = JSON.parse(await navigator.clipboard.readText())
      if (data.componentsTree) {
        const target = doc?.rootNode

        if (!target) {
          return
        }

        const nodes = insertChildren(target, data.componentsTree)
        if (nodes) {
          selection.selectAll(nodes.map(o => o.id))
        }
      }
    },
  },
  {
    key: 'duplicate',
    label: '复制',
    icon: ClipboardPen,
    onClick() {
      const doc = project.currentDocument
      const selection = project.designer.selection
      if (!doc) {
        return
      }

      const selected = selection.getTopNodes(false)
      if (!selected || selected.length < 1) {
        return
      }

      const newNodesId: string[] = []
      for (const node of selected) {
        const cloneNodeSchema = node.export(TRANSFORM_STAGE.CLONE)
        // 表单场景不需要位置偏移，直接插入到下一个位置
        const newNode = doc.insertNode(node.parent!, cloneNodeSchema, node.index + 1)
        if (newNode) {
          newNodesId.push(newNode.id)
        }
      }
      selection.selectAll(newNodesId)
    },
    separator: true,
  },
  {
    key: 'hide',
    label: '隐藏',
    icon: Eye,
    shortcut: '⌘⇧H',
    onClick() {
      const selection = project.designer.selection
      if (!selection) {
        return
      }

      const selected = selection.getTopNodes(false)
      if (!selected || selected.length < 1) {
        return
      }

      for (const node of selected) {
        node.hide()
      }
      selection.clear()
    },
  },
  {
    key: 'show',
    label: '显示',
    icon: Eye,
    onClick() {
      const selection = project.designer.selection
      if (!selection) {
        return
      }

      const selected = selection.getTopNodes(false)
      if (!selected || selected.length < 1) {
        return
      }

      for (const node of selected) {
        node.hide(false)
      }
    },
  },
  {
    key: 'lock',
    label: '锁定',
    icon: Lock,
    shortcut: '⌘⇧L',
    onClick() {
      const selection = project.designer.selection
      if (!selection) {
        return
      }

      const selected = selection.getTopNodes(false)
      if (!selected || selected.length < 1) {
        return
      }

      for (const node of selected) {
        node.lock()
      }
      selection.clear()
    },
    separator: true,
  },
  {
    key: 'delete',
    label: '删除',
    icon: Trash2,
    shortcut: 'Del',
    onClick() {
      const selection = project.designer.selection
      if (!selection) {
        return
      }

      const selected = selection.getTopNodes(false)
      if (!selected || selected.length < 1) {
        return
      }

      for (const node of selected) {
        node.remove()
      }
      selection.clear()
    },
  },
]

const getMenuItems = (selectionType: SelectionType) => {
  let keys = []
  switch (selectionType) {
    case SelectionType.NONE:
      keys = ['paste']
      break
    case SelectionType.SINGLE:
      keys = ['copy', 'paste', 'duplicate', 'hide', 'show', 'lock', 'delete']
      break
    case SelectionType.MULTIPLE:
      keys = ['copy', 'paste', 'duplicate', 'hide', 'show', 'lock', 'delete']
      break
  }

  return menuItems.filter(item => keys.includes(item.key))
}

interface RendererContextMenuProps extends PropsWithChildren {}

export const RendererContextMenu = observer(({ children }: RendererContextMenuProps) => {
  const currentDoc = project.currentDocument
  if (!currentDoc) {
    return children
  }

  const selection = project.designer.selection
  const selected = selection.getTopNodes(false)
  const selectionType =
    selected.length === 0 ? SelectionType.NONE : selected.length === 1 ? SelectionType.SINGLE : SelectionType.MULTIPLE
  const menuItems = getMenuItems(selectionType)

  return (
    <ContextMenu>
      <ContextMenuTrigger style={{ height: '100%' }}>{children}</ContextMenuTrigger>
      <ContextMenuContent className='w-40'>
        {menuItems.map(item => (
          <Fragment key={item.key}>
            <ContextMenuItem className='h-8 px-2 text-xs gap-0' onClick={item?.onClick}>
              {item.icon && <item.icon className='w-4 h-4 mr-2' />}
              {item.label}
              {item.shortcut && <ContextMenuShortcut className='text-xs'>{item.shortcut}</ContextMenuShortcut>}
            </ContextMenuItem>
            {item.separator && <ContextMenuSeparator className='my-1' />}
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
})
