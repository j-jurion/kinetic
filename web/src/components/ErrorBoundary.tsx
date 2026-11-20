import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  /** Shown instead of the children after they fail to render. */
  fallback: ReactNode
  children: ReactNode
}

/** Keeps a failing part of a page (such as a chart) from blanking the whole page. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Part of the page failed to render', error, info.componentStack)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
