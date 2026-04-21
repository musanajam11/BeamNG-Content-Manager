import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { Loader2 } from 'lucide-react'

loader.config({ monaco })

type Monaco = typeof monaco

export interface CompletionItem {
  key: string
  kind: string
  inherited?: boolean
}

interface Props {
  value: string
  onChange: (v: string) => void
  onRun: () => void
  onInspect: (path: string) => void
  /** Returns runtime completion candidates from the live BeamNG VM. */
  onComplete?: (prefix: string) => Promise<CompletionItem[]>
  /** Called on Up-arrow when the cursor is at the start of the editor. */
  onHistoryPrev?: () => string | null
  onHistoryNext?: () => string | null
  wordWrap: boolean
}

const BEAM_KEYWORDS = [
  'be', 'core_environment', 'core_camera', 'core_vehicle_manager',
  'core_vehicles', 'spawn', 'extensions', 'Lua', 'guihooks', 'ui_imgui',
  'scenetree', 'TorqueScript', 'getCurrentLevelIdentifier', 'commands',
  'log', 'print', 'jsonEncode', 'jsonDecode', 'tableToString', 'dump',
  'vec3', 'quat', 'getPlayerVehicle', 'getObjectByID',
  'MP', 'MPConfig', 'MPCoreNetwork', 'MPVehicleGE', 'MPGameNetwork',
  'TriggerServerEvent', 'TriggerClientEvent', 'AddEventHandler',
  'GetPlayerName', 'GetPlayers', 'SendChatMessage',
]

let providerRegistered = false
let themeRegistered = false
const liveCompleteRef: { current: Props['onComplete'] } = { current: undefined }

function ensureDevToolsTheme(m: Monaco): void {
  if (themeRegistered) return
  themeRegistered = true
  m.editor.defineTheme('beammp-devtools', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#00000012',
      'editorGutter.background': '#00000000',
      'minimap.background': '#00000010',
      'editor.lineHighlightBackground': '#ffffff08',
      'editor.selectionBackground': '#f9731640',
      'editor.inactiveSelectionBackground': '#ffffff14',
      'scrollbar.shadow': '#00000000',
      'editorWidget.background': '#00000066',
      'editorWidget.border': '#ffffff18',
    },
  })
}

function kindToMonaco(kind: string, m: Monaco): monaco.languages.CompletionItemKind {
  switch (kind) {
    case 'function': return m.languages.CompletionItemKind.Function
    case 'table': return m.languages.CompletionItemKind.Module
    case 'string': return m.languages.CompletionItemKind.Text
    case 'number': return m.languages.CompletionItemKind.Value
    case 'boolean': return m.languages.CompletionItemKind.Constant
    case 'userdata': return m.languages.CompletionItemKind.Interface
    default: return m.languages.CompletionItemKind.Variable
  }
}

function registerLua(m: Monaco): void {
  if (providerRegistered) return
  providerRegistered = true
  m.languages.registerCompletionItemProvider('lua', {
    triggerCharacters: ['.', ':'],
    provideCompletionItems: async (model, position) => {
      const lineText = model.getLineContent(position.lineNumber)
      let start = position.column - 1
      while (start > 0 && /[\w.]/.test(lineText[start - 1])) start--
      const prefix = lineText.slice(start, position.column - 1)
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      }
      const live = liveCompleteRef.current
      if (live) {
        try {
          const items = await live(prefix)
          if (items && items.length > 0) {
            return {
              suggestions: items.map((it) => ({
                label: it.key,
                kind: kindToMonaco(it.kind, m),
                insertText: it.key,
                range,
                detail: it.inherited ? `${it.kind} (inherited)` : it.kind,
                sortText: (it.inherited ? '1' : '0') + it.key,
              })),
            }
          }
        } catch { /* fall through */ }
      }
      if (prefix.includes('.')) return { suggestions: [] }
      const leaf = prefix.toLowerCase()
      const filtered = BEAM_KEYWORDS.filter((k) => k.toLowerCase().startsWith(leaf))
      return {
        suggestions: filtered.map((kw) => ({
          label: kw,
          kind: m.languages.CompletionItemKind.Function,
          insertText: kw,
          range,
          detail: 'BeamNG / BeamMP',
        })),
      }
    },
  })
}

export function LuaConsoleEditor(p: Props): React.JSX.Element {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const onRunRef = useRef(p.onRun)
  const onInspectRef = useRef(p.onInspect)
  const onHistoryPrevRef = useRef(p.onHistoryPrev)
  const onHistoryNextRef = useRef(p.onHistoryNext)
  useEffect(() => { onRunRef.current = p.onRun }, [p.onRun])
  useEffect(() => { onInspectRef.current = p.onInspect }, [p.onInspect])
  useEffect(() => { onHistoryPrevRef.current = p.onHistoryPrev }, [p.onHistoryPrev])
  useEffect(() => { onHistoryNextRef.current = p.onHistoryNext }, [p.onHistoryNext])
  useEffect(() => { liveCompleteRef.current = p.onComplete }, [p.onComplete])

  const handleMount: OnMount = (ed, m) => {
    editorRef.current = ed
    ensureDevToolsTheme(m)
    m.editor.setTheme('beammp-devtools')
    registerLua(m)
    ed.addAction({
      id: 'lua-console-run',
      label: 'Run Lua',
      keybindings: [m.KeyMod.CtrlCmd | m.KeyCode.Enter, m.KeyMod.Shift | m.KeyCode.Enter],
      run: () => { onRunRef.current() },
    })
    ed.addAction({
      id: 'lua-console-inspect',
      label: 'Inspect symbol under cursor',
      keybindings: [m.KeyMod.CtrlCmd | m.KeyMod.Shift | m.KeyCode.KeyI],
      run: () => {
        const model = ed.getModel()
        const pos = ed.getPosition()
        if (!model || !pos) return
        const word = model.getWordAtPosition(pos)
        if (!word) return
        const lineText = model.getLineContent(pos.lineNumber)
        let start = word.startColumn
        while (start > 1 && /[\w.]/.test(lineText[start - 2])) start--
        let end = word.endColumn
        while (end <= lineText.length && /[\w.]/.test(lineText[end - 1])) end++
        const path = lineText.slice(start - 1, end - 1)
        onInspectRef.current(path)
      },
    })

    // History recall via Up/Down at editor extremes (when suggest widget is closed).
    const isAtStart = (): boolean => {
      const pos = ed.getPosition()
      return !!pos && pos.lineNumber === 1 && pos.column === 1
    }
    const isAtEnd = (): boolean => {
      const pos = ed.getPosition()
      const model = ed.getModel()
      if (!pos || !model) return false
      const lastLine = model.getLineCount()
      return pos.lineNumber === lastLine && pos.column === model.getLineMaxColumn(lastLine)
    }
    const suggestVisible = (): boolean => {
      const c = ed.getContribution('editor.contrib.suggestController') as { model?: { state: number } } | null
      return !!c?.model && c.model.state !== 0
    }
    ed.addCommand(m.KeyCode.UpArrow, () => {
      if (suggestVisible()) { ed.trigger('keyboard', 'selectPrevSuggestion', null); return }
      if (!isAtStart()) { ed.trigger('keyboard', 'cursorUp', null); return }
      const prev = onHistoryPrevRef.current?.()
      if (prev != null) {
        ed.setValue(prev)
        const model = ed.getModel()
        if (model) {
          const lastLine = model.getLineCount()
          ed.setPosition({ lineNumber: lastLine, column: model.getLineMaxColumn(lastLine) })
        }
      }
    })
    ed.addCommand(m.KeyCode.DownArrow, () => {
      if (suggestVisible()) { ed.trigger('keyboard', 'selectNextSuggestion', null); return }
      if (!isAtEnd()) { ed.trigger('keyboard', 'cursorDown', null); return }
      const next = onHistoryNextRef.current?.()
      if (next != null) {
        ed.setValue(next)
        const model = ed.getModel()
        if (model) {
          const lastLine = model.getLineCount()
          ed.setPosition({ lineNumber: lastLine, column: model.getLineMaxColumn(lastLine) })
        }
      }
    })
    ed.focus()
  }

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      <Editor
        height="100%"
        language="lua"
        value={p.value}
        onChange={(v) => p.onChange(v ?? '')}
        onMount={handleMount}
        theme="beammp-devtools"
        options={{
          // Console++ — keep syntax niceties (ligatures, bracket colorization,
          // folding, smooth scroll) but drop the heavy IDE chrome (minimap +
          // overview ruler) so it reads like a prompt, not an editor viewport.
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
          fontLigatures: true,
          minimap: { enabled: false },
          overviewRulerLanes: 0,
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          scrollbar: { vertical: 'auto', verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
          scrollBeyondLastLine: false,
          wordWrap: p.wordWrap ? 'on' : 'off',
          automaticLayout: true,
          tabSize: 2,
          renderWhitespace: 'selection',
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          padding: { top: 8 },
          lineNumbersMinChars: 3,
          folding: true,
          renderLineHighlight: 'line',
          suggest: { showKeywords: true, showSnippets: true },
          quickSuggestions: { other: true, comments: false, strings: false },
          suggestOnTriggerCharacters: true,
        }}
        loading={
          <div className="flex items-center justify-center h-full bg-[var(--color-surface)] backdrop-blur-sm">
            <Loader2 size={20} className="animate-spin text-[var(--color-text-muted)]" />
          </div>
        }
      />
      {!p.value.trim() && (
        <div className="pointer-events-none absolute top-2 left-16 text-xs text-[var(--color-text-muted)] font-mono leading-relaxed select-none">
          <div className="opacity-70">-- Type Lua here. Ctrl+Enter to run.</div>
          <div className="opacity-70">-- Examples:</div>
          <div className="opacity-50">print(dumps(extensions.list()))</div>
          <div className="opacity-50">guihooks.trigger('toastrMsg', {`{type='info', title='Hi', msg='from CM'}`})</div>
          <div className="opacity-50">be:reloadUI()</div>
          <div className="opacity-50">-- Or right-click any item in the inspector ➜ "Print value" / "Insert into editor"</div>
        </div>
      )}
    </div>
  )
}
