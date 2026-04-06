import { useState, useCallback, useRef } from 'react'
import { ConfirmDialog } from '../components/server-manager/ConfirmDialog'

interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'default'
}

export function useConfirmDialog(): {
  dialog: React.JSX.Element | null
  confirm: (opts: ConfirmOptions) => Promise<boolean>
} {
  const [state, setState] = useState<(ConfirmOptions & { open: boolean }) | null>(null)
  const resolveRef = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
      setState({ ...opts, open: true })
    })
  }, [])

  const close = useCallback((result: boolean) => {
    setState(null)
    resolveRef.current?.(result)
    resolveRef.current = null
  }, [])

  const dialog = state?.open ? (
    <ConfirmDialog
      open
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      variant={state.variant}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  ) : null

  return { dialog, confirm }
}
