import { Pencil, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { InputAction, InputBinding } from '../../../../shared/types'
import { getControlDisplayName } from '../../../../shared/controlNameMaps'

interface BindingRowProps {
  action: InputAction
  bindings: InputBinding[]
  onEdit: (action: InputAction) => void
  onClear: (control: string, action: string) => void
}

export function BindingRow({ action, bindings, onEdit, onClear }: BindingRowProps): React.JSX.Element {
  const { t } = useTranslation()
  const displayTitle = action.title.startsWith('ui.')
    ? formatActionId(action.id)
    : action.title

  return (
    <div className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--color-surface-hover)] transition-colors group">
      {/* Action name */}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-[var(--color-text-primary)] truncate">
          {displayTitle}
        </div>
        {action.desc && (
          <div className="text-[10px] text-[var(--color-text-muted)] truncate">
            {action.desc.startsWith('ui.') ? '' : action.desc}
          </div>
        )}
      </div>

      {/* Binding badges */}
      <div className="flex items-center gap-1.5 shrink-0">
        {bindings.length > 0 ? (
          bindings.map((b, i) => (
            <span
              key={`${b.control}-${i}`}
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono rounded border ${
                b.isUserOverride
                  ? 'bg-[var(--color-accent-subtle)] border-[var(--color-accent)]/30 text-[var(--color-accent)]'
                  : 'bg-black/20 border-[var(--color-border)] text-[var(--color-text-secondary)]'
              }`}
            >
              {getControlDisplayName(b.control)}
              <button
                onClick={(e) => { e.stopPropagation(); onClear(b.control, action.id) }}
                className="opacity-0 group-hover:opacity-100 ml-0.5 p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 transition-all"
                title={t('controls.clearBinding')}
              >
                <X size={10} />
              </button>
            </span>
          ))
        ) : (
          <span className="text-[10px] text-[var(--color-text-muted)] italic">—</span>
        )}
      </div>

      {/* Edit button */}
      <button
        onClick={() => onEdit(action)}
        className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-[var(--color-accent-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-all shrink-0"
        title={t('controls.editBinding')}
      >
        <Pencil size={12} />
      </button>
    </div>
  )
}

function formatActionId(id: string): string {
  return id
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim()
}
