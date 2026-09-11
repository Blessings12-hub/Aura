import { Component } from 'react';

export default class AppErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('[Aura] Unhandled application error', error);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="aura-page" style={{ display: 'grid', minHeight: '100vh', placeItems: 'center', padding: 24, textAlign: 'center' }}>
        <section className="aura-card" role="alert" style={{ maxWidth: 440 }}>
          <h1>Something went wrong</h1>
          <p className="aura-muted">Aura could not load this screen. Your account data is still protected.</p>
          <button type="button" className="aura-btn aura-btn-primary" onClick={this.handleReload}>Reload Aura</button>
        </section>
      </main>
    );
  }
}
