import { ChevronDown, ChevronRight } from 'lucide-react'
import type { InputBinding, InputAction } from '../../../../shared/types'
import { BindingRow } from './BindingRow'

interface BindingCategoryProps {
  categoryId: string
  categoryName: string
  actions: InputAction[]
  bindings: InputBinding[]
  expanded: boolean
  onToggle: () => void
  search: string
  onEdit: (action: InputAction) => void
  onClear: (control: string, action: string) => void
}

export function BindingCategory({
  categoryId,
  categoryName,
  actions,
  bindings,
  expanded,
  onToggle,
  search,
  onEdit,
  onClear
}: BindingCategoryProps): React.JSX.Element | null {
  // Filter actions by search
  const filteredActions = search
    ? actions.filter(
        (a) =>
          a.id.toLowerCase().includes(search) ||
          a.title.toLowerCase().includes(search) ||
          (a.desc && a.desc.toLowerCase().includes(search))
      )
    : actions

  if (filteredActions.length === 0) return null

  // Count bindings in this category
  const boundCount = filteredActions.filter((a) =>
    bindings.some((b) => b.action === a.id && !b.isRemoved)
  ).length

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-4 py-2.5 text-left bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-[var(--color-text-muted)]" />
        ) : (
          <ChevronRight size={14} className="text-[var(--color-text-muted)]" />
        )}
        <span className="text-sm font-medium text-[var(--color-text-primary)] flex-1">
          {categoryName}
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)] tabular-nums">
          {boundCount}/{filteredActions.length}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--color-border)] divide-y divide-[var(--color-border)]">
          {filteredActions.map((action) => {
            const actionBindings = bindings.filter(
              (b) => b.action === action.id && !b.isRemoved
            )
            return (
              <BindingRow
                key={`${categoryId}::${action.id}`}
                action={action}
                bindings={actionBindings}
                onEdit={onEdit}
                onClear={onClear}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
