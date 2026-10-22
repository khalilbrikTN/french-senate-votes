import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  // Changing this value clears a caught error (e.g. the current view, so leaving a crashed view resets it).
  resetKey?: unknown;
  // Replaces the default fallback, e.g. to render it inside a dialog.
  fallback?: (reload: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

function reloadPage() {
  window.location.reload();
}

export function ErrorFallback({ onReload = reloadPage }: { onReload?: () => void }) {
  return (
    <div className="react-shell-card" role="alert">
      <div className="error-state">
        <div className="error-icon" aria-hidden="true">⚠️</div>
        <h2>Une erreur est survenue</h2>
        <p>Cette partie du site n’a pas pu s’afficher. Rechargez la page pour réessayer ; si le problème persiste, revenez un peu plus tard.</p>
        <button className="btn-primary react-shell-action" type="button" onClick={onReload}>
          Recharger la page
        </button>
      </div>
    </div>
  );
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Erreur d’affichage interceptée :', error, info.componentStack);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.hasError && !Object.is(prevProps.resetKey, this.props.resetKey)) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback(reloadPage);
    return (
      <main className="main-content view-panel react-shell-main">
        <div className="container react-shell-content">
          <ErrorFallback />
        </div>
      </main>
    );
  }
}
