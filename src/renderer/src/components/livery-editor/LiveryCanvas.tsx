import { useEffect, useRef, useCallback } from 'react'
import * as fabric from 'fabric'
import { useLiveryStore } from '../../stores/useLiveryStore'
import type { LiveryTool } from '../../stores/useLiveryStore'

interface LiveryCanvasProps {
  canvasRef: React.MutableRefObject<fabric.Canvas | null>
  onStateChange: () => void
}

export function LiveryCanvas({ canvasRef, onStateChange }: LiveryCanvasProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasElRef = useRef<HTMLCanvasElement>(null)

  const templateDataUrl = useLiveryStore((s) => s.templateDataUrl)
  const templateWidth = useLiveryStore((s) => s.templateWidth)
  const templateHeight = useLiveryStore((s) => s.templateHeight)
  const activeTool = useLiveryStore((s) => s.activeTool)
  const shapeType = useLiveryStore((s) => s.shapeType)
  const brushSettings = useLiveryStore((s) => s.brushSettings)
  const fillColor = useLiveryStore((s) => s.fillColor)
  const strokeColor = useLiveryStore((s) => s.strokeColor)
  const strokeWidth = useLiveryStore((s) => s.strokeWidth)
  const fontSize = useLiveryStore((s) => s.fontSize)
  const fontFamily = useLiveryStore((s) => s.fontFamily)
  const zoom = useLiveryStore((s) => s.zoom)
  const setZoom = useLiveryStore((s) => s.setZoom)
  const setCanvasReady = useLiveryStore((s) => s.setCanvasReady)
  const markDirty = useLiveryStore((s) => s.markDirty)
  const setFillColor = useLiveryStore((s) => s.setFillColor)
  const setTool = useLiveryStore((s) => s.setTool)
  const layers = useLiveryStore((s) => s.layers)

  // Shape drawing state
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null)
  const activeShapeRef = useRef<fabric.FabricObject | null>(null)
  const isPanningRef = useRef(false)
  const panStartRef = useRef<{ x: number; y: number } | null>(null)

  // Initialize canvas
  useEffect(() => {
    if (!canvasElRef.current || canvasRef.current) return

    const canvas = new fabric.Canvas(canvasElRef.current, {
      width: templateWidth,
      height: templateHeight,
      backgroundColor: '#1a1a2e',
      selection: true,
      preserveObjectStacking: true,
    })

    canvasRef.current = canvas
    setCanvasReady(true)

    // Set up state change listeners
    const stateEvents = ['object:added', 'object:removed', 'object:modified'] as const
    for (const ev of stateEvents) {
      canvas.on(ev, () => { onStateChange(); markDirty() })
    }

    // Eraser: set globalCompositeOperation on paths drawn in eraser mode
    canvas.on('path:created', (opt: { path: fabric.FabricObject }) => {
      if (useLiveryStore.getState().activeTool === 'eraser' && opt.path) {
        opt.path.globalCompositeOperation = 'destination-out'
        canvas.renderAll()
      }
    })

    // Tag new objects with the active layer ID
    canvas.on('object:added', (opt: { target: fabric.FabricObject }) => {
      if (!opt.target || opt.target === canvas.backgroundImage) return
      const layerId = useLiveryStore.getState().activeLayerId
      if (layerId && !(opt.target as unknown as { layerId?: string }).layerId) {
        ;(opt.target as unknown as { layerId: string }).layerId = layerId
      }
    })

    return () => {
      canvas.dispose()
      canvasRef.current = null
      setCanvasReady(false)
    }
  }, [templateWidth, templateHeight]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load UV template as background
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    if (templateDataUrl) {
      const img = new Image()
      img.onload = () => {
        const fabricImg = new fabric.FabricImage(img, {
          left: 0,
          top: 0,
          selectable: false,
          evented: false,
          opacity: 0.4,
        })
        fabricImg.scaleToWidth(templateWidth)
        canvas.set('backgroundImage', fabricImg)
        canvas.renderAll()
      }
      img.src = templateDataUrl
    } else {
      // No template — draw a grid pattern for guidance
      drawGridBackground(canvas, templateWidth, templateHeight)
    }
  }, [templateDataUrl, templateWidth, templateHeight, canvasRef])

  // Handle zoom
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const container = containerRef.current
    if (!container) return

    const vw = container.clientWidth
    const vh = container.clientHeight

    canvas.setZoom(zoom)
    canvas.setDimensions({
      width: Math.max(templateWidth * zoom, vw),
      height: Math.max(templateHeight * zoom, vh)
    })
    canvas.renderAll()
  }, [zoom, templateWidth, templateHeight, canvasRef])

  // Scroll zoom with Ctrl+wheel
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      setZoom(zoom * delta)
    }

    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [zoom, setZoom])

  // Tool mode management
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    configureTool(canvas, activeTool, brushSettings, fillColor)
  }, [activeTool, brushSettings, fillColor, canvasRef])

  // Shape drawing handlers
  const handleMouseDown = useCallback((e: fabric.TPointerEventInfo) => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Pan tool: start dragging
    if (activeTool === 'pan') {
      isPanningRef.current = true
      panStartRef.current = { x: (e.e as MouseEvent).clientX, y: (e.e as MouseEvent).clientY }
      canvas.selection = false
      canvas.defaultCursor = 'grabbing'
      return
    }

    if (activeTool !== 'shape') return

    const pointer = canvas.getScenePoint(e.e)
    shapeStartRef.current = { x: pointer.x, y: pointer.y }

    let shape: fabric.FabricObject
    const opts = {
      left: pointer.x,
      top: pointer.y,
      fill: fillColor,
      stroke: strokeColor,
      strokeWidth,
      selectable: false,
      evented: false,
    }

    switch (shapeType) {
      case 'rect':
        shape = new fabric.Rect({ ...opts, width: 1, height: 1 })
        break
      case 'circle':
        shape = new fabric.Ellipse({ ...opts, rx: 1, ry: 1 })
        break
      case 'triangle':
        shape = new fabric.Triangle({ ...opts, width: 1, height: 1 })
        break
      case 'line':
        shape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
          stroke: strokeColor,
          strokeWidth,
          selectable: false,
          evented: false,
        })
        break
      default:
        return
    }

    canvas.add(shape)
    activeShapeRef.current = shape
  }, [activeTool, shapeType, fillColor, strokeColor, strokeWidth, canvasRef])

  const handleMouseMove = useCallback((e: fabric.TPointerEventInfo) => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Pan tool: drag to translate viewport
    if (isPanningRef.current && panStartRef.current) {
      const me = e.e as MouseEvent
      const dx = me.clientX - panStartRef.current.x
      const dy = me.clientY - panStartRef.current.y
      const vpt = canvas.viewportTransform.slice() as typeof canvas.viewportTransform
      vpt[4] += dx
      vpt[5] += dy
      canvas.setViewportTransform(vpt)
      panStartRef.current = { x: me.clientX, y: me.clientY }
      return
    }

    if (!shapeStartRef.current || !activeShapeRef.current) return
    if (activeTool !== 'shape') return

    const pointer = canvas.getScenePoint(e.e)
    const start = shapeStartRef.current
    const shape = activeShapeRef.current

    const width = Math.abs(pointer.x - start.x)
    const height = Math.abs(pointer.y - start.y)
    const left = Math.min(pointer.x, start.x)
    const top = Math.min(pointer.y, start.y)

    if (shape instanceof fabric.Rect || shape instanceof fabric.Triangle) {
      shape.set({ left, top, width, height })
    } else if (shape instanceof fabric.Ellipse) {
      shape.set({ left, top, rx: width / 2, ry: height / 2 })
    } else if (shape instanceof fabric.Line) {
      shape.set({ x2: pointer.x, y2: pointer.y } as Partial<fabric.Line>)
    }

    canvas.renderAll()
  }, [activeTool, canvasRef])

  const handleMouseUp = useCallback(() => {
    // Pan tool: end drag
    if (isPanningRef.current) {
      isPanningRef.current = false
      panStartRef.current = null
      const canvas = canvasRef.current
      if (canvas) {
        canvas.selection = useLiveryStore.getState().activeTool === 'select'
        canvas.defaultCursor = 'grab'
      }
      return
    }

    if (activeShapeRef.current) {
      activeShapeRef.current.set({ selectable: true, evented: true })
      activeShapeRef.current = null
      shapeStartRef.current = null
      const canvas = canvasRef.current
      if (canvas) canvas.renderAll()
    }
  }, [canvasRef])

  // Text tool — click to add text
  const handleCanvasClick = useCallback((e: fabric.TPointerEventInfo) => {
    const canvas = canvasRef.current
    if (!canvas) return

    if (activeTool === 'text') {
      const pointer = canvas.getScenePoint(e.e)
      const text = new fabric.Textbox('Text', {
        left: pointer.x,
        top: pointer.y,
        fontSize,
        fontFamily,
        fill: fillColor,
        stroke: strokeColor,
        strokeWidth: 0,
        width: 200,
        editable: true,
      })
      canvas.add(text)
      canvas.setActiveObject(text)
      text.enterEditing()
      canvas.renderAll()
      return
    }

    if (activeTool === 'eyedropper') {
      const pointer = canvas.getScenePoint(e.e)
      const ctx = canvas.getContext()
      const px = ctx.getImageData(Math.round(pointer.x * zoom), Math.round(pointer.y * zoom), 1, 1).data
      const hex = `#${px[0].toString(16).padStart(2, '0')}${px[1].toString(16).padStart(2, '0')}${px[2].toString(16).padStart(2, '0')}`
      setFillColor(hex)
      setTool('select')
      return
    }

    if (activeTool === 'fill') {
      const target = (e as unknown as { target?: fabric.FabricObject }).target
      if (target && target !== canvas.backgroundImage) {
        target.set('fill', fillColor)
        canvas.renderAll()
        onStateChange()
        markDirty()
      }
    }
  }, [activeTool, fontSize, fontFamily, fillColor, strokeColor, zoom, canvasRef, setFillColor, setTool, onStateChange, markDirty])

  // Register fabric event handlers
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    canvas.on('mouse:down', handleMouseDown)
    canvas.on('mouse:move', handleMouseMove)
    canvas.on('mouse:up', handleMouseUp)
    canvas.on('mouse:down', handleCanvasClick)

    return () => {
      canvas.off('mouse:down', handleMouseDown)
      canvas.off('mouse:move', handleMouseMove)
      canvas.off('mouse:up', handleMouseUp)
      canvas.off('mouse:down', handleCanvasClick)
    }
  }, [handleMouseDown, handleMouseMove, handleMouseUp, handleCanvasClick, canvasRef])

  // Fit to container on mount
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const fitZoom = Math.min(
      container.clientWidth / templateWidth,
      container.clientHeight / templateHeight,
      1
    )
    setZoom(fitZoom)
  }, [templateWidth, templateHeight, setZoom])

  // Sync layer visibility / lock / opacity to canvas objects
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const currentTool = useLiveryStore.getState().activeTool
    canvas.forEachObject((obj) => {
      if (obj === canvas.backgroundImage) return
      const layerId = (obj as unknown as { layerId?: string }).layerId
      if (!layerId) return
      const layer = layers.find((l) => l.id === layerId)
      if (layer) {
        obj.visible = layer.visible
        obj.selectable = layer.visible && !layer.locked && currentTool === 'select'
        obj.evented = layer.visible && !layer.locked
        obj.opacity = layer.opacity
      }
    })
    canvas.renderAll()
  }, [layers, canvasRef])

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto bg-[#0d0d1a] relative"
      style={{ cursor: getCursorForTool(activeTool) }}
    >
      <div
        style={{
          width: templateWidth * zoom,
          height: templateHeight * zoom,
          margin: 'auto',
          position: 'relative',
        }}
      >
        <canvas ref={canvasElRef} />
      </div>
    </div>
  )
}

function configureTool(
  canvas: fabric.Canvas,
  tool: LiveryTool,
  brushSettings: { size: number; color: string; opacity: number },
  fillColor: string
): void {
  // Reset drawing mode
  canvas.isDrawingMode = false
  canvas.selection = true
  canvas.defaultCursor = 'default'

  // Make all objects selectable/non-selectable based on tool
  const interactive = tool === 'select'
  canvas.forEachObject((obj) => {
    if (obj === canvas.backgroundImage) return
    obj.selectable = interactive
    obj.evented = interactive || tool === 'fill'
  })

  switch (tool) {
    case 'select':
      canvas.defaultCursor = 'default'
      break
    case 'draw':
      canvas.isDrawingMode = true
      canvas.freeDrawingBrush = new fabric.PencilBrush(canvas)
      canvas.freeDrawingBrush.width = brushSettings.size
      canvas.freeDrawingBrush.color = fillColor
      ;(canvas.freeDrawingBrush as unknown as { opacity: number }).opacity = brushSettings.opacity
      break
    case 'eraser':
      canvas.isDrawingMode = true
      canvas.freeDrawingBrush = new fabric.PencilBrush(canvas)
      canvas.freeDrawingBrush.width = brushSettings.size
      canvas.freeDrawingBrush.color = 'rgba(0,0,0,1)'
      break
    case 'shape':
      canvas.selection = false
      canvas.defaultCursor = 'crosshair'
      break
    case 'text':
      canvas.defaultCursor = 'text'
      break
    case 'eyedropper':
      canvas.defaultCursor = 'crosshair'
      break
    case 'fill':
      canvas.defaultCursor = 'pointer'
      break
    case 'pan':
      canvas.selection = false
      canvas.defaultCursor = 'grab'
      break
  }

  canvas.renderAll()
}

function getCursorForTool(tool: LiveryTool): string {
  switch (tool) {
    case 'draw': return 'crosshair'
    case 'eraser': return 'crosshair'
    case 'shape': return 'crosshair'
    case 'text': return 'text'
    case 'eyedropper': return 'crosshair'
    case 'fill': return 'pointer'
    case 'pan': return 'grab'
    default: return 'default'
  }
}

function drawGridBackground(canvas: fabric.Canvas, width: number, height: number): void {
  const gridSize = 64
  const lines: fabric.FabricObject[] = []

  for (let x = 0; x <= width; x += gridSize) {
    lines.push(new fabric.Line([x, 0, x, height], {
      stroke: '#ffffff',
      strokeWidth: 0.5,
      opacity: 0.06,
      selectable: false,
      evented: false,
    }))
  }

  for (let y = 0; y <= height; y += gridSize) {
    lines.push(new fabric.Line([0, y, width, y], {
      stroke: '#ffffff',
      strokeWidth: 0.5,
      opacity: 0.06,
      selectable: false,
      evented: false,
    }))
  }

  const group = new fabric.Group(lines, {
    selectable: false,
    evented: false,
  })
  canvas.set('backgroundImage', group as unknown as fabric.FabricImage)
  canvas.renderAll()
}
