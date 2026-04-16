import { create } from 'zustand'

export type LiveryTool =
  | 'select'
  | 'draw'
  | 'eraser'
  | 'shape'
  | 'text'
  | 'eyedropper'
  | 'fill'
  | 'pan'

export type ShapeType = 'rect' | 'circle' | 'line' | 'triangle'

export interface LayerInfo {
  id: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
}

export interface BrushSettings {
  size: number
  color: string
  opacity: number
}

interface LiveryState {
  // Vehicle selection
  selectedVehicle: string | null
  vehicleDisplayName: string | null
  templateDataUrl: string | null
  templateWidth: number
  templateHeight: number

  // Tool state
  activeTool: LiveryTool
  shapeType: ShapeType
  brushSettings: BrushSettings
  fillColor: string
  strokeColor: string
  strokeWidth: number
  fontSize: number
  fontFamily: string

  // Layer state
  layers: LayerInfo[]
  activeLayerId: string | null

  // Canvas state
  zoom: number
  isPanning: boolean
  canvasReady: boolean

  // Project
  projectDirty: boolean
  projectPath: string | null

  // Actions
  setVehicle: (name: string | null, displayName: string | null) => void
  setTemplate: (dataUrl: string | null, width: number, height: number) => void
  setTool: (tool: LiveryTool) => void
  setShapeType: (shape: ShapeType) => void
  setBrushSettings: (partial: Partial<BrushSettings>) => void
  setFillColor: (color: string) => void
  setStrokeColor: (color: string) => void
  setStrokeWidth: (width: number) => void
  setFontSize: (size: number) => void
  setFontFamily: (family: string) => void
  setZoom: (zoom: number) => void
  setIsPanning: (panning: boolean) => void
  setCanvasReady: (ready: boolean) => void
  markDirty: () => void
  markClean: () => void
  setProjectPath: (path: string | null) => void

  // Layer actions
  addLayer: (name?: string) => void
  removeLayer: (id: string) => void
  renameLayer: (id: string, name: string) => void
  setLayerVisibility: (id: string, visible: boolean) => void
  setLayerLocked: (id: string, locked: boolean) => void
  setLayerOpacity: (id: string, opacity: number) => void
  setActiveLayer: (id: string | null) => void
  reorderLayers: (layers: LayerInfo[]) => void

  // Reset
  reset: () => void
}

let layerCounter = 0

const initialState = {
  selectedVehicle: null as string | null,
  vehicleDisplayName: null as string | null,
  templateDataUrl: null as string | null,
  templateWidth: 2048,
  templateHeight: 2048,
  activeTool: 'select' as LiveryTool,
  shapeType: 'rect' as ShapeType,
  brushSettings: { size: 8, color: '#ff0000', opacity: 1 },
  fillColor: '#ff0000',
  strokeColor: '#000000',
  strokeWidth: 2,
  fontSize: 48,
  fontFamily: 'Arial',
  layers: [] as LayerInfo[],
  activeLayerId: null as string | null,
  zoom: 1,
  isPanning: false,
  canvasReady: false,
  projectDirty: false,
  projectPath: null as string | null,
}

export const useLiveryStore = create<LiveryState>((set) => ({
  ...initialState,

  setVehicle: (name, displayName) => set({ selectedVehicle: name, vehicleDisplayName: displayName }),
  setTemplate: (dataUrl, width, height) => set({ templateDataUrl: dataUrl, templateWidth: width, templateHeight: height }),
  setTool: (tool) => set({ activeTool: tool }),
  setShapeType: (shape) => set({ shapeType: shape }),
  setBrushSettings: (partial) =>
    set((s) => ({ brushSettings: { ...s.brushSettings, ...partial } })),
  setFillColor: (color) => set({ fillColor: color }),
  setStrokeColor: (color) => set({ strokeColor: color }),
  setStrokeWidth: (width) => set({ strokeWidth: width }),
  setFontSize: (size) => set({ fontSize: size }),
  setFontFamily: (family) => set({ fontFamily: family }),
  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(10, zoom)) }),
  setIsPanning: (panning) => set({ isPanning: panning }),
  setCanvasReady: (ready) => set({ canvasReady: ready }),
  markDirty: () => set({ projectDirty: true }),
  markClean: () => set({ projectDirty: false }),
  setProjectPath: (path) => set({ projectPath: path }),

  addLayer: (name?: string) =>
    set((s) => {
      const id = `layer_${++layerCounter}_${Date.now()}`
      const newLayer: LayerInfo = {
        id,
        name: name || `Layer ${s.layers.length + 1}`,
        visible: true,
        locked: false,
        opacity: 1
      }
      return {
        layers: [...s.layers, newLayer],
        activeLayerId: id,
        projectDirty: true
      }
    }),

  removeLayer: (id) =>
    set((s) => {
      const newLayers = s.layers.filter((l) => l.id !== id)
      return {
        layers: newLayers,
        activeLayerId: s.activeLayerId === id
          ? (newLayers.length > 0 ? newLayers[newLayers.length - 1].id : null)
          : s.activeLayerId,
        projectDirty: true
      }
    }),

  renameLayer: (id, name) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, name } : l)),
      projectDirty: true
    })),

  setLayerVisibility: (id, visible) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, visible } : l)),
      projectDirty: true
    })),

  setLayerLocked: (id, locked) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, locked } : l)),
      projectDirty: true
    })),

  setLayerOpacity: (id, opacity) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, opacity } : l)),
      projectDirty: true
    })),

  setActiveLayer: (id) => set({ activeLayerId: id }),

  reorderLayers: (layers) => set({ layers, projectDirty: true }),

  reset: () => {
    layerCounter = 0
    set(initialState)
  }
}))
