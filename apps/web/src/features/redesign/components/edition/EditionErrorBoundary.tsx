/**
 * EditionErrorBoundary — catches render-time errors inside the
 * editorial home so a single broken section doesn't blank the page.
 *
 * Per .claude/rules/reexamine_resilience.md: error boundaries must
 * render an actionable fallback, not a blank screen.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Optional inline label for the fallback message. */
  label?: string;
}

interface State {
  error: Error | null;
}

export class EditionErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console-log only — telemetry hookup is out of scope for 7a.
    // eslint-disable-next-line no-console
    console.error("[EditorialHome]", this.props.label ?? "section", error, info);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="rd-edition-empty"
          style={{ borderTop: "1px solid var(--rd-line)", paddingTop: 12 }}
        >
          Something went wrong rendering this section.
          {" "}
          <button
            type="button"
            onClick={this.handleReset}
            className="rd-btn rd-btn--quiet rd-btn--sm"
            style={{ marginLeft: 8 }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
