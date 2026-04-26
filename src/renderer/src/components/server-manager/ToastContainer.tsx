import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'
import { useToastStore } from '../../stores/useToastStore'

const icons = {
  success: <CheckCircle size={32} className="text-green-400 shrink-0" />,
  error: <AlertCircle size={32} className="text-red-400 shrink-0" />,
  info: <Info size={32} className="text-blue-400 shrink-0" />
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
    <div className="fixed bottom-8 right-8 z-50 flex flex-col gap-4 max-w-lg">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-4 px-6 py-5 rounded-xl border shadow-lg backdrop-blur-sm text-lg text-[var(--color-text-primary)] animate-in slide-in-from-right ${bgColors[t.type]}`}
          style={{ animation: 'slideIn 0.2s ease-out' }}
        >
          {icons[t.type]}
          <span className="flex-1">{t.message}</span>
          <button onClick={() => removeToast(t.id)} className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors">
            <X size={28} />
          </button>
        </div>
      ))}
    </div>
  )
}
