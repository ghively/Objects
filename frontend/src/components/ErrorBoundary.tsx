// Keeps one broken view (say, a hand-edited definition file the UI can't read) from blanking
// the whole app: the failing subtree shows a short message instead, and a new `resetKey`
// (another tab or target) tries again.
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** Changing it clears the error and renders the children again. */
  resetKey?: string
  /** What failed, for the message ("This page", "The sidebar"). */
  what?: string
  children: ReactNode
}

interface State {
  error: Error | null
  key: string | undefined
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${this.props.what ?? 'A view'} could not be shown:`, error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" className="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="font-semibold">{this.props.what ?? 'This view'} could not be shown</p>
        <p className="max-w-md text-[13px] text-fg-muted">{error.message}</p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-1 rounded-md border border-line bg-raised px-3 py-1 text-[13px] hover:bg-hover"
        >
          Try again
        </button>
      </div>
    )
  }
}
