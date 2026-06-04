import { HolderOutlined } from '@ant-design/icons'
import { List } from 'antd'
import { useEffect, useRef, useState, type ReactNode } from 'react'

export function reorderById<T extends { id: number }>(items: T[], dragId: number, targetId: number): T[] | null {
  const from = items.findIndex((i) => i.id === dragId)
  const to = items.findIndex((i) => i.id === targetId)
  if (from < 0 || to < 0 || from === to) return null
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

type SortableOrderListProps<T extends { id: number }> = {
  items: T[]
  loading?: boolean
  onPersistOrder: (orderedIds: number[]) => Promise<void>
  renderContent: (item: T, index: number) => ReactNode
  renderActions?: (item: T) => ReactNode
  isItemDraggable?: (item: T) => boolean
}

export function SortableOrderList<T extends { id: number }>({
  items,
  loading,
  onPersistOrder,
  renderContent,
  renderActions,
  isItemDraggable,
}: SortableOrderListProps<T>) {
  const [localItems, setLocalItems] = useState(items)
  const dragIdRef = useRef<number | null>(null)
  const [dragOverId, setDragOverId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLocalItems(items)
  }, [items])

  const canDrag = (item: T) => (isItemDraggable ? isItemDraggable(item) : true)

  const commitReorder = async (next: T[]) => {
    setLocalItems(next)
    setSaving(true)
    try {
      await onPersistOrder(next.map((i) => i.id))
    } catch {
      setLocalItems(items)
    } finally {
      setSaving(false)
      dragIdRef.current = null
      setDragOverId(null)
    }
  }

  const handleDrop = (targetId: number) => {
    const dragId = dragIdRef.current
    if (dragId == null || dragId === targetId) return
    const next = reorderById(localItems, dragId, targetId)
    if (!next) return
    void commitReorder(next)
  }

  return (
    <List
      loading={loading || saving}
      dataSource={localItems}
      renderItem={(item, index) => {
        const draggable = canDrag(item)
        return (
          <List.Item
            style={{
              cursor: draggable ? 'grab' : 'default',
              background: dragOverId === item.id ? 'rgba(22, 119, 255, 0.08)' : undefined,
              borderRadius: 6,
            }}
            draggable={draggable}
            onDragStart={() => {
              if (!draggable) return
              dragIdRef.current = item.id
            }}
            onDragOver={(e) => {
              if (!draggable || dragIdRef.current == null) return
              e.preventDefault()
              setDragOverId(item.id)
            }}
            onDragLeave={() => {
              if (dragOverId === item.id) setDragOverId(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (!draggable) return
              handleDrop(item.id)
            }}
            onDragEnd={() => {
              dragIdRef.current = null
              setDragOverId(null)
            }}
            actions={renderActions ? [renderActions(item)] : undefined}
          >
            <SpaceLikeRow draggable={draggable}>
              {draggable ? (
                <HolderOutlined style={{ color: '#999', marginRight: 8 }} />
              ) : (
                <span style={{ display: 'inline-block', width: 22, marginRight: 8 }} />
              )}
              {renderContent(item, index)}
            </SpaceLikeRow>
          </List.Item>
        )
      }}
    />
  )
}

function SpaceLikeRow({ draggable, children }: { draggable: boolean; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', userSelect: draggable ? 'none' : undefined }}>{children}</div>
  )
}
