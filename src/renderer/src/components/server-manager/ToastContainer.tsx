import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'
import { useToastStore } from '../../stores/useToastStore'

const icons = {
  success: <CheckCircle size={16} className="text-green-400 shrink-0" />,
  error: <AlertCircle size={16} className="text-red-400 shrink-0" />,
  info: <Info size={16} className="text-blue-400 shrink-0" />
}

const bgColors = {
  success: 'border-green-500/30 bg-green-500/10',
  error: 'border-red-500/30 bg-red-500/10',
  info: 'border-blue-500/30 bg-blue-500/10'
}

export function ToastContainer(): React.JSX.Element | null {
  const { toasts, removeToast } = useToastStore()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border shadow-lg backdrop-blur-sm text-sm text-[var(--color-text-primary)] animate-in slide-in-from-right ${bgColors[t.type]}`}
          style={{ animation: 'slideIn 0.2s ease-out' }}
        >
          {icons[t.type]}
          <span className="flex-1">{t.message}</span>
          <button onClick={() => removeToast(t.id)} className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
