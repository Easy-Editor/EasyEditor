import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { TRANSFORM_STAGE, insertChildren, project } from '@easy-editor/core'
import {
  ArrowDown,
  ArrowUp,
  Clipboard,
  ClipboardCopy,
  ClipboardPaste,
  ClipboardPen,
  Eye,
  Group,
  Layers,
  Lock,
  PanelBottom,
  PanelTop,
  Trash2,
  Ungroup,
} from 'lucide-react'
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
  children?: MenuItem[]
  separator?: boolean
  shortcut?: string
  onClick?: () => void
}

const menuItems: MenuItem[] = [
  {
    key: 'layer',
    label: '图层',
    icon: Layers,
    children: [
      {
        key: 'layer-top',
        label: '置顶',
        icon: PanelTop,
        onClick: () => {
          const selection = project.designer.selection
          if (!selection) {
            return
          }

          const selected = selection.getTopNodes(false)
          if (!selected || selected.length < 1) {
            return
          }

          for (let i = selected.length - 1; i >= 0; i--) {
            const node = selected[i]
            node.levelTop()
          }
        },
      },
      {
        key: 'layer-bottom',
        label: '置底',
        icon: PanelBottom,
        onClick: () => {
          const selection = project.designer.selection
          if (!selection) {
            return
          }

          const selected = selection.getTopNodes(false)
          if (!selected || selected.length < 1) {
            return
          }

          for (let i = selected.length - 1; i >= 0; i--) {
            const node = selected[i]
            node.levelBottom()
          }
        },
      },
      {
        key: 'layer-up',
        label: '上移一层',
        icon: ArrowUp,
        onClick: () => {
          const selection = project.designer.selection
          if (!selection) {
            return
          }

          const selected = selection.getTopNodes(false)
          if (!selected || selected.length < 1) {
            return
          }

          for (let i = selected.length - 1; i >= 0; i--) {
            const node = selected[i]
            node.levelUp()
          }
        },
      },
      {
        key: 'layer-down',
        label: '下移一层',
        icon: ArrowDown,
        onClick: () => {
          const selection = project.designer.selection
          if (!selection) {
            return
          }

          const selected = selection.getTopNodes(false)
          if (!selected || selected.length < 1) {
            return
          }

          for (let i = selected.length - 1; i >= 0; i--) {
            const node = selected[i]
            node.levelDown()
          }
        },
      },
    ],
  },
  {
    key: 'group',
    label: '成组',
    icon: Group,
  },
  {
    key: 'ungroup',
    label: '取消成组',
    icon: Ungroup,
    separator: true,
  },
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
    key: 'cv',
    label: '拷贝',
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
        // 添加偏移
        cloneNodeSchema.$dashboard!.rect!.x = (cloneNodeSchema.$dashboard!.rect!.x ?? 0) + 10
        cloneNodeSchema.$dashboard!.rect!.y = (cloneNodeSchema.$dashboard!.rect!.y ?? 0) + 10
        // 插入
        const newNode = doc.insertNode(node.parent!, cloneNodeSchema, node.index + 1)
        if (newNode) {
          newNodesId.push(newNode.id)
        }
      }
      selection.selectAll(newNodesId)
    },
  },
  {
    key: 'copy-paste-as',
    label: '...复制/粘贴为',
    icon: Clipboard,
    children: [
      {
        key: 'copy-component-style',
        label: '复制组件样式',
      },
      {
        key: 'paste-component-style',
        label: '粘贴组件样式',
      },
      {
        key: 'copy-component-event',
        label: '复制组件事件',
      },
      {
        key: 'paste-component-event',
        label: '粘贴组件事件',
      },
    ],
    separator: true,
  },

  {
    key: 'show',
    label: '显示',
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
        node.hide(false)
      }
    },
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
    key: 'unlock',
    label: '解锁',
    icon: Lock,
    shortcut: '⌘⇧L',
    separator: true,
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
        node.lock(false)
      }
      selection.clear()
    },
  },
  {
    key: 'lock',
    label: '锁定',
    icon: Lock,
    shortcut: '⌘⇧L',
    separator: true,
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
      keys = ['layer', 'group', 'ungroup', 'copy', 'paste', 'cv', 'copy-paste-as', 'hide', 'lock', 'delete']
      break
    case SelectionType.MULTIPLE:
      keys = ['layer', 'group', 'ungroup', 'copy', 'paste', 'cv', 'hide', 'lock', 'delete']
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
      <ContextMenuTrigger className='w-full h-full'>{children}</ContextMenuTrigger>
      <ContextMenuContent className='w-40'>
        {menuItems.map(item => (
          <Fragment key={item.key}>
            {item.children ? (
              <ContextMenuSub>
                <ContextMenuSubTrigger className='text-xs h-8 px-2'>
                  {item.icon && <item.icon className='w-4 h-4 mr-2' />}
                  {item.label}
                  {item.shortcut && <ContextMenuShortcut className='text-xs'>{item.shortcut}</ContextMenuShortcut>}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className='w-32 text-xs'>
                  {item.children.map(child => (
                    <Fragment key={child.key}>
                      <ContextMenuItem className='h-8 px-2 text-xs gap-0' onClick={child?.onClick}>
                        {child.icon && <child.icon className='w-4 h-4 mr-2' />}
                        {child.label}
                        {child.shortcut && (
                          <ContextMenuShortcut className='text-xs'>{child.shortcut}</ContextMenuShortcut>
                        )}
                      </ContextMenuItem>
                      {child.separator && <ContextMenuSeparator className='my-1' />}
                    </Fragment>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            ) : (
              <ContextMenuItem key={item.key} className='h-8 px-2 text-xs gap-0' onClick={item?.onClick}>
                {item.icon && <item.icon className='w-4 h-4 mr-2' />}
                {item.label}
                {item.shortcut && <ContextMenuShortcut className='text-xs'>{item.shortcut}</ContextMenuShortcut>}
              </ContextMenuItem>
            )}
            {item.separator && <ContextMenuSeparator className='my-1' />}
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
})
