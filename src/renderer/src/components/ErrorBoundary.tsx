import React from 'react'
import i18next from 'i18next'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
          <p className="text-red-400 text-sm font-medium">{i18next.t('common.somethingWentWrong')}</p>
          <pre className="text-xs text-[var(--text-muted)] bg-[var(--bg-tertiary)] p-4 rounded-lg max-w-lg overflow-auto">
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white text-sm transition-colors"
          >
            {i18next.t('common.tryAgain')}
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
