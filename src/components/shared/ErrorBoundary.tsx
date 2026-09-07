import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Stops one broken component from blanking the whole application.
 *
 * Recovery is a reload rather than a state reset: whatever put the tree into a
 * bad state is usually still there, and a member standing at an event needs the
 * fastest reliable way back to a working page.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Detail for whoever is debugging; the member sees the message below.
    console.error("[shpe] uncaught error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 text-center">
        <h1 className="text-2xl font-bold text-shpe-navy">Something went wrong</h1>
        <p className="mt-3 text-gray-600">
          This page hit an unexpected error. Reloading usually fixes it. If it keeps happening,
          let a SHPE officer know what you were doing.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={() => window.location.reload()}>Reload the page</Button>
          <Button variant="outline" onClick={() => window.location.assign(import.meta.env.BASE_URL)}>
            Go to the homepage
          </Button>
        </div>
      </div>
    );
  }
}
