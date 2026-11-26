import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  /** Shown instead of the children after they fail to render. */
  fallback: ReactNode
  children: ReactNode
  /**
   * Tries the children again when this changes (such as the page's path). Unlike a React key it
   * keeps the boundary itself mounted, so it also catches errors thrown while the previous
   * children are removed.
   */
  resetKey?: unknown
}

interface State {
  failed: boolean
  resetKey: unknown
}

/** Keeps a failing part of a page (such as a chart) from blanking the whole page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, resetKey: this.props.resetKey }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { failed: false, resetKey: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Part of the page failed to render', error, info.componentStack)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
