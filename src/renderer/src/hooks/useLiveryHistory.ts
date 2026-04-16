import { useCallback, useRef } from 'react'
import type { Canvas as FabricCanvas } from 'fabric'

const MAX_HISTORY = 50

interface HistoryEntry {
  json: string
  timestamp: number
}

export function useLiveryHistory(canvasRef: React.MutableRefObject<FabricCanvas | null>) {
  const undoStack = useRef<HistoryEntry[]>([])
  const redoStack = useRef<HistoryEntry[]>([])
  const isRestoring = useRef(false)

  const saveState = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || isRestoring.current) return

    const json = JSON.stringify((canvas as any).toJSON(['id', 'name', 'selectable', 'evented', 'layerId']))
    const last = undoStack.current[undoStack.current.length - 1]
    if (last && last.json === json) return

    undoStack.current.push({ json, timestamp: Date.now() })
    if (undoStack.current.length > MAX_HISTORY) {
      undoStack.current.shift()
    }
    redoStack.current = []
  }, [canvasRef])

  const undo = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas || undoStack.current.length <= 1) return

    isRestoring.current = true
    const current = undoStack.current.pop()!
    redoStack.current.push(current)

    const prev = undoStack.current[undoStack.current.length - 1]
    if (prev) {
      await canvas.loadFromJSON(prev.json)
      canvas.renderAll()
    }
    isRestoring.current = false
  }, [canvasRef])

  const redo = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas || redoStack.current.length === 0) return

    isRestoring.current = true
    const next = redoStack.current.pop()!
    undoStack.current.push(next)

    await canvas.loadFromJSON(next.json)
    canvas.renderAll()
    isRestoring.current = false
  }, [canvasRef])

  const canUndo = useCallback(() => undoStack.current.length > 1, [])
  const canRedo = useCallback(() => redoStack.current.length > 0, [])

  const clearHistory = useCallback(() => {
    undoStack.current = []
    redoStack.current = []
  }, [])

  return { saveState, undo, redo, canUndo, canRedo, clearHistory, isRestoring }
}
