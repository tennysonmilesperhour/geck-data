"use client";
// React error boundary that routes caught render/lifecycle errors into
// public.error_logs via reportError(). Paired with installGlobalErrorHandlers
// (window.error + unhandledrejection), this closes the three main pipelines
// from the original Analytics handoff.
//
// Rendered once at the root layout. Renders its children unmodified on the
// happy path; on error, shows a minimal fallback so the user isn't staring
// at a white page.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/lib/telemetry";

type Props = { children: ReactNode };
type State = { hasError: boolean; message?: string };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void reportError(error, {
      type: "react.errorBoundary",
      componentStack: info.componentStack ?? null,
    });
  }

  private reset = () => this.setState({ hasError: false, message: undefined });

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="mx-auto my-12 max-w-xl rounded-lg border border-danger/40 bg-danger/10 p-5 text-sm text-danger">
        <p className="font-semibold">Something broke on this page.</p>
        <p className="mt-1 text-ink-300">
          The error was logged. You can try reloading, or go back and try a
          different action.
        </p>
        {this.state.message ? (
          <pre className="mt-3 whitespace-pre-wrap rounded bg-ink-900/60 p-2 text-xs text-ink-300">
            {this.state.message}
          </pre>
        ) : null}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={this.reset}
            className="rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-ink-200 hover:border-ink-600 hover:text-ink-50"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-claude px-3 py-1.5 text-ink-50 shadow-glow hover:bg-claude-glow"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
