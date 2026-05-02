import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren<object>, ErrorBoundaryState> {
  constructor(props: React.PropsWithChildren<object>) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo });
    // Expose to window for debugging
    (window as unknown as Record<string, unknown>).__RENDER_ERROR__ = { error, errorInfo };
    console.error('[ErrorBoundary] Render error:', error.message);
    console.error('[ErrorBoundary] Stack:', error.stack);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px',
          maxWidth: '600px',
          margin: '40px auto',
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#333',
          background: '#f5f5f5',
          border: '1px solid #ddd',
          borderRadius: '8px',
        }}>
          <h2 style={{ color: '#c00', marginBottom: '16px' }}>Erro de renderização</h2>
          <p><strong>Mensagem:</strong> {this.state.error?.message}</p>
          <details style={{ marginTop: '16px', whiteSpace: 'pre-wrap' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold', marginBottom: '8px' }}>Stack trace</summary>
            <pre style={{ fontSize: '11px', overflow: 'auto', background: '#fff', padding: '8px' }}>
              {this.state.error?.stack}
            </pre>
          </details>
          <details style={{ marginTop: '12px', whiteSpace: 'pre-wrap' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold', marginBottom: '8px' }}>Component stack</summary>
            <pre style={{ fontSize: '11px', overflow: 'auto', background: '#fff', padding: '8px' }}>
              {this.state.errorInfo?.componentStack}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
