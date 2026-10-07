import type { HTMLAttributes, ReactNode } from "react";

type AgentScreenState = "ready" | "loading" | "empty" | "error" | "blocked";

interface AgentScreenProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  children: ReactNode;
  screenId: string;
  screenTitle: string;
  screenPath: string;
  routeView?: string | null;
  screenState?: AgentScreenState;
}

export function AgentScreen({
  children,
  className,
  screenId,
  screenTitle,
  screenPath,
  routeView,
  screenState = "ready",
  ...rest
}: AgentScreenProps) {
  return (
    <div
      role="region"
      aria-label={screenTitle}
      className={className}
      data-main-content
      data-screen-id={screenId}
      data-screen-title={screenTitle}
      data-screen-path={screenPath}
      data-screen-state={screenState}
      data-screen-surface="primary"
      data-agent-id={`view:${screenId}:content`}
      data-agent-label={screenTitle}
      data-current-view={screenId}
      data-route-view={routeView ?? screenId}
      {...rest}
    >
      {children}
    </div>
  );
}
