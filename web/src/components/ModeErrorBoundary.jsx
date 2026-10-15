import { Component } from "react";

// Wraps one mode (Library, Bench, Holes) so an exception thrown while
// rendering it shows a message in that mode's place instead of React
// unmounting the whole app to a blank page. The nav bar stays up, so
// switching to another tab still works; App keys this by mode, so a
// switch also gives the next mode a fresh boundary. "Try again" re-renders
// the mode (enough when the throw came from a transient state); "Reload"
// is the fallback when it keeps throwing. The sessions behind the modes
// (lib/benchSession.js, lib/holesSession.js) live outside React, so
// neither loses the bench or the holes.
//
// A class component because error boundaries have no hook equivalent.
export default class ModeErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`${this.props.label} crashed:`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      // .error-screen is the app's full-window message; inside the shell it
      // fills the mode's area instead, and stacks its lines.
      <div
        className="error-screen"
        role="alert"
        style={{ height: "100%", flexDirection: "column", gap: "0.5rem" }}
      >
        <p>
          Something went wrong in {this.props.label}. Try again, switch to another tab, or reload the page.
        </p>
        <p>
          <code>{error?.message ?? String(error)}</code>
        </p>
        <p>
          <button type="button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>{" "}
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </p>
      </div>
    );
  }
}
