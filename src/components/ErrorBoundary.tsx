import { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { recordError } from "@/lib/errorBuffer";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Top-level render-error catch-all. Before this, a render-time exception
 * anywhere in the tree (e.g. a malformed/missing Sheets response reaching
 * a `.map`/property access) white-screened the entire app with no
 * recovery path - including mid-checkout or mid-bidding at a live event,
 * where a crash is especially high-cost. Found in a hardening audit - see
 * docs/agents/CHANGELOG.md's Code Hardening item #1 /
 * CHANGELOG.md.
 *
 * A class component because componentDidCatch/getDerivedStateFromError
 * have no hook equivalent - this is the one place in the app that still
 * needs to be a class.
 *
 * Deliberately just offers a reload rather than a "try again" reset: the
 * error already happened once mid-render with real app state in play, and
 * this app doesn't know enough about what broke to safely re-render the
 * same subtree without risking an immediate repeat crash.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Feeds the same ring buffer a bug report's "Recent console activity"
    // section reads from - this crash is outside console's own reach.
    recordError(`${error.name}: ${error.message}`);
    console.error("[ErrorBoundary] Caught a render error:", error, errorInfo.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 px-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="text-center space-y-1">
            <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-destructive" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">Something went wrong</CardTitle>
            <CardDescription>
              The app hit an unexpected error and couldn't continue. Reloading usually fixes it - if it keeps happening, please report the issue.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-center text-xs text-muted-foreground font-mono break-words">
              {error.message}
            </p>
            <Button onClick={this.handleReload} size="lg" className="w-full">
              Reload Page
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
}
