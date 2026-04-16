import { useState, useRef, useCallback, useEffect } from 'react'
import * as fabric from 'fabric'
import { Paintbrush, ChevronLeft } from 'lucide-react'
import { useLiveryStore } from '../stores/useLiveryStore'
import { useLiveryHistory } from '../hooks/useLiveryHistory'
import { VehicleSelector } from '../components/livery-editor/VehicleSelector'
import { LiveryCanvas } from '../components/livery-editor/LiveryCanvas'
import { Toolbar } from '../components/livery-editor/Toolbar'
import { LayerPanel } from '../components/livery-editor/LayerPanel'
import { PropertiesPanel } from '../components/livery-editor/PropertiesPanel'
import { DecalLibrary } from '../components/livery-editor/DecalLibrary'
import { LiveryStatusBar } from '../components/livery-editor/StatusBar'

export function LiveryEditorPage(): React.JSX.Element {
  const canvasRef = useRef<fabric.Canvas | null>(null)
  const { saveState, undo, redo, canUndo, canRedo, clearHistory } = useLiveryHistory(canvasRef)

  const selectedVehicle = useLiveryStore((s) => s.selectedVehicle)
  const setVehicle = useLiveryStore((s) => s.setVehicle)
  const setTemplate = useLiveryStore((s) => s.setTemplate)
  const addLayer = useLiveryStore((s) => s.addLayer)
  const removeLayer = useLiveryStore((s) => s.removeLayer)
  const setActiveLayer = useLiveryStore((s) => s.setActiveLayer)
  const reset = useLiveryStore((s) => s.reset)
  const markClean = useLiveryStore((s) => s.markClean)
  const setProjectPath = useLiveryStore((s) => s.setProjectPath)

  const [loading, setLoading] = useState(false)

  // ── Vehicle selection handler ──
  const handleVehicleSelect = useCallback(async (vehicleName: string, displayName: string) => {
    setLoading(true)
    try {
      const result = await window.api.liveryGetUVTemplate(vehicleName)
      setVehicle(vehicleName, displayName)
      setTemplate(result.template, result.width, result.height)
      clearHistory()

      // Auto-add first layer
      addLayer('Layer 1')

      // Save initial state after a brief delay for canvas init
      setTimeout(() => saveState(), 100)
    } catch (err) {
      console.error('Failed to load UV template:', err)
    }
    setLoading(false)
  }, [setVehicle, setTemplate, clearHistory, addLayer, saveState])

  // ── Back to vehicle selector ──
  const handleBackToSelector = useCallback(() => {
    reset()
    clearHistory()
  }, [reset, clearHistory])

  // ── Layer actions ──
  const handleLayerAdd = useCallback(() => {
    addLayer()
    saveState()
  }, [addLayer, saveState])

  const handleLayerRemove = useCallback((layerId: string) => {
    const canvas = canvasRef.current
    if (canvas) {
      // Remove objects belonging to this layer
      const objects = canvas.getObjects().filter((obj) => (obj as unknown as { layerId?: string }).layerId === layerId)
      for (const obj of objects) canvas.remove(obj)
    }
    removeLayer(layerId)
    saveState()
  }, [removeLayer, saveState])

  const handleLayerSelect = useCallback((layerId: string) => {
    setActiveLayer(layerId)
  }, [setActiveLayer])

  // ── Decal add ──
  const handleAddDecal = useCallback((svg: string, name: string) => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Convert SVG string to data URL
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)

    fabric.FabricImage.fromURL(url).then((img) => {
      img.set({
        left: canvas.width! / 2 / (canvas.getZoom() || 1) - (img.width || 100) / 2,
        top: canvas.height! / 2 / (canvas.getZoom() || 1) - (img.height || 100) / 2,
        scaleX: 0.5,
        scaleY: 0.5,
      })
      img.set('name' as keyof fabric.FabricImage, name as never)
      canvas.add(img)
      canvas.setActiveObject(img)
      canvas.renderAll()
      URL.revokeObjectURL(url)
      saveState()
    }).catch(() => {
      URL.revokeObjectURL(url)
    })
  }, [saveState])

  // ── Import image ──
  const handleImportImage = useCallback(async () => {
    const dataUrl = await window.api.liveryImportImage()
    if (!dataUrl) return

    const canvas = canvasRef.current
    if (!canvas) return

    fabric.FabricImage.fromURL(dataUrl).then((img) => {
      img.set({
        left: canvas.width! / 2 / (canvas.getZoom() || 1) - (img.width || 100) / 2,
        top: canvas.height! / 2 / (canvas.getZoom() || 1) - (img.height || 100) / 2,
      })
      // Scale down if larger than canvas
      const maxDim = Math.max(img.width || 1, img.height || 1)
      if (maxDim > canvas.width! / 2) {
        const scale = (canvas.width! / 2) / maxDim
        img.set({ scaleX: scale, scaleY: scale })
      }
      canvas.add(img)
      canvas.setActiveObject(img)
      canvas.renderAll()
      saveState()
    })
  }, [saveState])

  // ── Save project ──
  const handleSave = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const store = useLiveryStore.getState()
    const projectData = {
      version: 1,
      vehicleName: store.selectedVehicle,
      vehicleDisplayName: store.vehicleDisplayName,
      templateWidth: store.templateWidth,
      templateHeight: store.templateHeight,
      canvasJson: JSON.stringify(canvas.toJSON(['id', 'name', 'selectable', 'evented', 'layerId'])),
      layerMeta: store.layers.map((l) => ({
        name: l.name,
        visible: l.visible,
        locked: l.locked,
        opacity: l.opacity
      }))
    }

    const result = await window.api.liverySaveProject(JSON.stringify(projectData))
    if (result.success) {
      markClean()
      if (result.filePath) setProjectPath(result.filePath)
    }
  }, [markClean, setProjectPath])

  // ── Load project ──
  const handleLoad = useCallback(async () => {
    const result = await window.api.liveryLoadProject()
    if (!result.success || !result.data) return

    try {
      const projectData = JSON.parse(result.data)
      if (!projectData.vehicleName) return

      // Set vehicle and template
      setVehicle(projectData.vehicleName, projectData.vehicleDisplayName)

      // Load UV template for the vehicle
      const templateResult = await window.api.liveryGetUVTemplate(projectData.vehicleName)
      setTemplate(
        templateResult.template,
        projectData.templateWidth || templateResult.width,
        projectData.templateHeight || templateResult.height
      )

      // Wait for canvas to init then load canvas state
      setTimeout(async () => {
        const canvas = canvasRef.current
        if (!canvas || !projectData.canvasJson) return
        await canvas.loadFromJSON(projectData.canvasJson)
        canvas.renderAll()

        // Restore layer metadata
        const store = useLiveryStore.getState()
        store.reorderLayers(
          (projectData.layerMeta || []).map(
            (l: { name: string; visible: boolean; locked: boolean; opacity: number }, i: number) => ({
              id: `layer_restored_${i}_${Date.now()}`,
              ...l
            })
          )
        )

        clearHistory()
        saveState()
        markClean()
      }, 200)
    } catch (err) {
      console.error('Failed to load project:', err)
    }
  }, [setVehicle, setTemplate, clearHistory, saveState, markClean])

  // ── Export skin mod ──
  const handleExport = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const store = useLiveryStore.getState()
    if (!store.selectedVehicle) return

    // Flatten canvas to PNG (without background to get clean skin)
    const bgImage = canvas.backgroundImage
    canvas.set('backgroundImage', undefined)
    canvas.backgroundColor = 'transparent'
    canvas.renderAll()

    const dataUrl = canvas.toDataURL({
      format: 'png',
      multiplier: 1,
      width: store.templateWidth,
      height: store.templateHeight,
      left: 0,
      top: 0,
    })

    // Restore background
    canvas.set('backgroundImage', bgImage)
    canvas.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--color-base').trim() || '#1a1a2e'
    canvas.renderAll()

    const result = await window.api.liveryExportSkinMod({
      vehicleName: store.selectedVehicle,
      skinName: store.vehicleDisplayName ? `${store.vehicleDisplayName} Custom` : 'Custom Livery',
      authorName: 'BeamMP Content Manager',
      canvasDataUrl: dataUrl,
      metallic: 0.1,
      roughness: 0.5,
      clearcoat: 0.8,
      clearcoatRoughness: 0.1
    })

    if (result.success) {
      // Could show a toast here
      console.log('Exported to:', result.filePath)
    } else {
      console.error('Export failed:', result.error)
    }
  }, [])

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const isCtrl = e.ctrlKey || e.metaKey
      const isShift = e.shiftKey

      // Skip if typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (isCtrl && e.key === 'z' && !isShift) { e.preventDefault(); undo(); return }
      if (isCtrl && e.key === 'z' && isShift) { e.preventDefault(); redo(); return }
      if (isCtrl && e.key === 'y') { e.preventDefault(); redo(); return }
      if (isCtrl && e.key === 's') { e.preventDefault(); handleSave(); return }
      if (isCtrl && e.key === 'e') { e.preventDefault(); handleExport(); return }

      // Tool shortcuts (no modifier)
      if (!isCtrl && !isShift) {
        const store = useLiveryStore.getState()
        switch (e.key.toLowerCase()) {
          case 'v': store.setTool('select'); break
          case 'b': store.setTool('draw'); break
          case 'e': store.setTool('eraser'); break
          case 'u': store.setTool('shape'); break
          case 't': store.setTool('text'); break
          case 'i': store.setTool('eyedropper'); break
          case 'g': store.setTool('fill'); break
          case 'h': store.setTool('pan'); break
          case '[': store.setBrushSettings({ size: Math.max(1, store.brushSettings.size - 2) }); break
          case ']': store.setBrushSettings({ size: Math.min(100, store.brushSettings.size + 2) }); break
          case 'delete':
          case 'backspace': {
            const canvas = canvasRef.current
            if (canvas) {
              const active = canvas.getActiveObjects()
              for (const obj of active) canvas.remove(obj)
              canvas.discardActiveObject()
              canvas.renderAll()
              saveState()
            }
            break
          }
        }
      }

      // Copy/Paste
      if (isCtrl && e.key === 'c') {
        const canvas = canvasRef.current
        if (!canvas) return
        const active = canvas.getActiveObject()
        if (active) {
          active.clone().then((cloned: fabric.FabricObject) => {
            ;(canvas as unknown as { _clipboard: fabric.FabricObject })._clipboard = cloned
          })
        }
      }

      if (isCtrl && e.key === 'v') {
        const canvas = canvasRef.current
        if (!canvas) return
        const clipboard = (canvas as unknown as { _clipboard?: fabric.FabricObject })._clipboard
        if (clipboard) {
          clipboard.clone().then((cloned: fabric.FabricObject) => {
            cloned.set({ left: (cloned.left || 0) + 20, top: (cloned.top || 0) + 20 })
            canvas.add(cloned)
            canvas.setActiveObject(cloned)
            canvas.renderAll()
            saveState()
          })
        }
      }

      // Duplicate
      if (isCtrl && e.key === 'd') {
        e.preventDefault()
        const canvas = canvasRef.current
        if (!canvas) return
        const active = canvas.getActiveObject()
        if (active) {
          active.clone().then((cloned: fabric.FabricObject) => {
            cloned.set({ left: (cloned.left || 0) + 20, top: (cloned.top || 0) + 20 })
            canvas.add(cloned)
            canvas.setActiveObject(cloned)
            canvas.renderAll()
            saveState()
          })
        }
      }

      // Select all
      if (isCtrl && e.key === 'a') {
        e.preventDefault()
        const canvas = canvasRef.current
        if (!canvas) return
        const sel = new fabric.ActiveSelection(canvas.getObjects(), { canvas })
        canvas.setActiveObject(sel)
        canvas.renderAll()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo, handleSave, handleExport, saveState])

  // ── Render ──

  // Show vehicle selector if no vehicle is selected
  if (!selectedVehicle) {
    return (
      <div className="flex flex-col h-full bg-[var(--color-surface)]">
        <VehicleSelector onSelect={handleVehicleSelect} />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--color-text-secondary)]">
        <Paintbrush size={32} className="animate-pulse text-[var(--color-accent)]" />
        <p className="text-sm">Loading UV template…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)]">
      {/* Toolbar */}
      <Toolbar
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo()}
        canRedo={canRedo()}
        onSave={handleSave}
        onLoad={handleLoad}
        onExport={handleExport}
        onImportImage={handleImportImage}
      />

      {/* Main content area */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar — Layers */}
        <div className="w-56 border-r border-[var(--color-border)] flex flex-col shrink-0">
          {/* Back button */}
          <button
            onClick={handleBackToSelector}
            className="flex items-center gap-1.5 px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface)] transition-colors border-b border-[var(--color-border)]"
          >
            <ChevronLeft size={14} />
            Change Vehicle
          </button>
          <div className="flex-1 min-h-0">
            <LayerPanel
              onLayerSelect={handleLayerSelect}
              onLayerAdd={handleLayerAdd}
              onLayerRemove={handleLayerRemove}
            />
          </div>
        </div>

        {/* Canvas */}
        <LiveryCanvas canvasRef={canvasRef} onStateChange={saveState} />

        {/* Right sidebar — Properties + Decals */}
        <div className="w-60 border-l border-[var(--color-border)] flex flex-col shrink-0">
          <div className="flex-1 min-h-0 border-b border-[var(--color-border)] overflow-hidden">
            <PropertiesPanel canvasRef={canvasRef} />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <DecalLibrary onAddDecal={handleAddDecal} onImportImage={handleImportImage} />
          </div>
        </div>
      </div>

      {/* Status bar */}
      <LiveryStatusBar />
    </div>
  )
}
