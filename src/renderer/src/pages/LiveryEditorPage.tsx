import { Paintbrush } from 'lucide-react'

export function LiveryEditorPage(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-400">
      <Paintbrush size={48} className="text-[var(--color-accent)] opacity-40" />
      <h1 className="text-xl font-semibold text-white">Livery Editor</h1>
      <p className="text-sm">Coming soon</p>
    </div>
  )
}
