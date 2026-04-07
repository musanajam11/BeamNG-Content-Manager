import { useState, useEffect, useCallback, useRef } from 'react'
import { Save, X, Loader2 } from 'lucide-react'
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { useTranslation } from 'react-i18next'

type Monaco = typeof monaco

// Use locally installed monaco-editor instead of CDN
loader.config({ monaco })

interface FileEditorProps {
  serverId: string
  filePath: string
  fileName: string
  onClose: () => void
}

const EXT_LANG: Record<string, string> = {
  '.lua': 'lua',
  '.json': 'json',
  '.jbeam': 'json',
  '.toml': 'toml',
  '.cfg': 'ini',
  '.ini': 'ini',
  '.txt': 'plaintext',
  '.md': 'markdown',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.html': 'html',
  '.css': 'css',
  '.js': 'javascript',
  '.ts': 'typescript',
  '.py': 'python',
  '.sh': 'shell',
  '.bat': 'bat',
  '.ps1': 'powershell',
  '.log': 'plaintext',
  '.csv': 'plaintext'
}

const LANG_LABELS: Record<string, string> = {
  lua: 'Lua',
  json: 'JSON',
  toml: 'TOML',
  ini: 'INI',
  plaintext: 'Text',
  markdown: 'Markdown',
  xml: 'XML',
  yaml: 'YAML',
  html: 'HTML',
  css: 'CSS',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  shell: 'Shell',
  bat: 'Batch',
  powershell: 'PowerShell'
}

function detectLang(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return 'plaintext'
  const ext = name.slice(dot).toLowerCase()
  return EXT_LANG[ext] ?? 'plaintext'
}

/* ── Register custom languages once ── */
let customLangsRegistered = false

function registerCustomLanguages(m: Monaco): void {
  if (customLangsRegistered) return
  customLangsRegistered = true

  // ── TOML ──
  m.languages.register({ id: 'toml', extensions: ['.toml'], aliases: ['TOML'] })
  m.languages.setMonarchTokensProvider('toml', {
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/\[\[[\w.-]+\]\]/, 'type.identifier'],     // array of tables
        [/\[[\w.-]+\]/, 'type.identifier'],          // table header
        [/[a-zA-Z_][\w.-]*(?=\s*=)/, 'variable'],   // key
        [/=/, 'delimiter'],
        [/"""/, { token: 'string', next: '@mlString3' }],
        [/'''/, { token: 'string', next: '@mlStringLit' }],
        [/"/, { token: 'string', next: '@string' }],
        [/'[^']*'/, 'string'],                       // literal string
        [/\b(true|false)\b/, 'keyword'],
        [/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?/, 'number.date'], // datetime
        [/[+-]?(\d+\.\d+([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?|\d+[eE][+-]?\d+)/, 'number.float'],
        [/0x[0-9a-fA-F_]+/, 'number.hex'],
        [/0o[0-7_]+/, 'number.octal'],
        [/0b[01_]+/, 'number.binary'],
        [/[+-]?\d[\d_]*/, 'number'],
        [/[[\]{}(),.]/, 'delimiter.bracket'],
      ],
      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, { token: 'string', next: '@pop' }],
      ],
      mlString3: [
        [/[^"\\]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"""/, { token: 'string', next: '@pop' }],
        [/"/, 'string'],
      ],
      mlStringLit: [
        [/[^']+/, 'string'],
        [/'''/, { token: 'string', next: '@pop' }],
        [/'/, 'string'],
      ],
    }
  })
  m.languages.setLanguageConfiguration('toml', {
    comments: { lineComment: '#' },
    brackets: [['[', ']'], ['{', '}']],
    autoClosingPairs: [
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  })

  // ── Enhance Lua with BeamNG/BeamMP keywords ──
  m.languages.registerCompletionItemProvider('lua', {
    provideCompletionItems: (_model, position) => {
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      }
      const beamKeywords = [
        'MP', 'TriggerServerEvent', 'TriggerClientEvent', 'RegisterEvent',
        'AddEventHandler', 'CreateTimer', 'CancelTimer',
        'GetPlayerName', 'GetPlayerCount', 'GetPlayers',
        'DropPlayer', 'SendChatMessage', 'GetPlayerVehicles',
        'print', 'log', 'jsonEncode', 'jsonDecode',
        'obj', 'be', 'electrics', 'wheels', 'controller',
        'guihooks', 'ui_imgui',
      ]
      return {
        suggestions: beamKeywords.map((kw) => ({
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

export function FileEditor({ serverId, filePath, fileName, onClose }: FileEditorProps): React.JSX.Element {
  const { t } = useTranslation()
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lang, setLang] = useState(() => detectLang(fileName))
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 })
  const [selection, setSelection] = useState('')
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)

  const isDirty = content !== original

  useEffect(() => {
    setLoading(true)
    setError(null)
    window.api
      .hostedServerReadFile(serverId, filePath)
      .then((text) => {
        setContent(text)
        setOriginal(text)
      })
      .catch((err) => setError(String(err?.message ?? err)))
      .finally(() => setLoading(false))
  }, [serverId, filePath])

  const handleSave = useCallback(async () => {
    if (!isDirty || saving) return
    setSaving(true)
    try {
      await window.api.hostedServerWriteFile(serverId, filePath, content)
      setOriginal(content)
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setSaving(false)
    }
  }, [serverId, filePath, content, isDirty, saving])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave])

  const handleEditorMount: OnMount = (ed, m) => {
    editorRef.current = ed
    monacoRef.current = m

    registerCustomLanguages(m)

    // Track cursor position
    ed.onDidChangeCursorPosition((e) => {
      setCursorPos({ line: e.position.lineNumber, col: e.position.column })
    })

    // Track selection length
    ed.onDidChangeCursorSelection((e) => {
      const sel = ed.getModel()?.getValueInRange(e.selection) ?? ''
      if (sel.length > 0) {
        const lines = sel.split('\n').length
        setSelection(lines > 1 ? `${sel.length} chars, ${lines} lines selected` : `${sel.length} selected`)
      } else {
        setSelection('')
      }
    })

    // Register Ctrl+S within Monaco too
    ed.addAction({
      id: 'file-save',
      label: 'Save File',
      keybindings: [m.KeyMod.CtrlCmd | m.KeyCode.KeyS],
      run: () => { handleSave() }
    })

    ed.focus()
  }

  // Switch Monaco model language when dropdown changes
  useEffect(() => {
    const ed = editorRef.current
    if (ed) {
      const model = ed.getModel()
      if (model) {
        monaco.editor.setModelLanguage(model, lang)
      }
    }
  }, [lang])

  const lineCount = content.split('\n').length

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-[var(--color-text-muted)]" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <p className="text-red-400 text-sm">{error}</p>
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">
          {t('common.goBack')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <button
          onClick={onClose}
          className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          title={t('serverManager.closeEditor')}
        >
          <X size={16} />
        </button>
        <span className="text-sm text-[var(--color-text-primary)] font-medium truncate">{fileName}</span>
        {isDirty && <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] shrink-0" title={t('serverManager.unsavedChanges')} />}
        <div className="ml-auto flex items-center gap-2">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            className="px-2 py-1 text-xs rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] outline-none"
          >
            {Object.entries(LANG_LABELS)
              .sort(([, a], [, b]) => a.localeCompare(b))
              .map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
          </select>
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-[var(--color-accent)] text-black hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            {t('serverManager.saveContent')}
          </button>
        </div>
      </div>

      {/* Monaco Editor */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language={lang}
          value={content}
          onChange={(v) => setContent(v ?? '')}
          onMount={handleEditorMount}
          theme="vs-dark"
          options={{
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
            fontLigatures: true,
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            wordWrap: 'off',
            automaticLayout: true,
            tabSize: 2,
            renderWhitespace: 'selection',
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: true, indentation: true },
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            padding: { top: 8 },
            lineNumbersMinChars: 4,
            folding: true,
            links: true,
            renderLineHighlight: 'line',
            suggest: { showKeywords: true, showSnippets: true },
            quickSuggestions: true
          }}
          loading={
            <div className="flex items-center justify-center h-full bg-[#1e1e1e]">
              <Loader2 size={20} className="animate-spin text-zinc-500" />
            </div>
          }
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-4 px-4 py-1 border-t border-[var(--color-border)] bg-[var(--color-bg)] text-[10px] text-[var(--color-text-muted)]">
        <span>{t('serverManager.lnCol', { line: cursorPos.line, col: cursorPos.col })}</span>
        {selection && <span>{selection}</span>}
        <span>{t('serverManager.lineCount_other', { count: lineCount })}</span>
        <span>{t('serverManager.charCount_other', { count: content.length })}</span>
        <span className="ml-auto">UTF-8</span>
        <span>{LANG_LABELS[lang] ?? lang}</span>
        <span>{t('serverManager.editorShortcuts')}</span>
      </div>
    </div>
  )
}
