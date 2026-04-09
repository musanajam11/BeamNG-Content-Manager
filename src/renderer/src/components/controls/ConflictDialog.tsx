import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { getControlDisplayName } from '../../../../shared/controlNameMaps'
import type { BindingConflict, ConflictResolution } from '../../../../shared/types'

interface ConflictDialogProps {
  conflict: BindingConflict
  onResolve: (resolution: ConflictResolution) => void
}

export function ConflictDialog({ conflict, onResolve }: ConflictDialogProps): React.JSX.Element {
  const { t } = useTranslation()

  const controlDisplay = getControlDisplayName(conflict.control)
  const actionsDisplay = conflict.existingActions.map(formatActionId).join(', ')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => onResolve('cancel')}
    >
      <div
        className="glass-raised w-[420px] p-5 rounded-lg flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <AlertTriangle size={18} className="text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t('controls.conflict')}
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed">
              <span className="font-mono text-[var(--color-accent)]">{controlDisplay}</span>
              {' '}{t('controls.conflictAlreadyBound')}{' '}
              <span className="font-medium text-[var(--color-text-primary)]">{actionsDisplay}</span>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onResolve('replace')}
            className="px-3 py-2 text-xs font-medium rounded-md bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            {t('controls.conflictReplace')}
          </button>
          <button
            onClick={() => onResolve('bindBoth')}
            className="px-3 py-2 text-xs font-medium rounded-md bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/20 transition-colors"
          >
            {t('controls.conflictBindBoth')}
          </button>
          <button
            onClick={() => onResolve('swap')}
            className="px-3 py-2 text-xs font-medium rounded-md bg-[var(--color-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            {t('controls.conflictSwap')}
          </button>
          <button
            onClick={() => onResolve('cancel')}
            className="px-3 py-2 text-xs font-medium rounded-md bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            {t('controls.conflictCancel')}
          </button>
        </div>
      </div>
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
