import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PanelHeader, type PanelHeaderProps } from './FastAgentPanel.PanelHeader';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@convex-dev/auth/react', () => ({
  useAuthActions: () => ({ signIn: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@/features/agents/components/DossierModeIndicator', () => ({
  DossierModeIndicator: () => null,
}));

afterEach(cleanup);

function compactHeaderProps(
  overrides: Partial<PanelHeaderProps> = {}
): PanelHeaderProps {
  return {
    activeThreadId: null,
    anonymousSession: {
      canSendMessage: true,
      isAnonymous: false,
      isLoading: false,
      limit: 5,
      remaining: 5,
    },
    appendToSignalsLog: vi.fn(async () => undefined),
    handleCopyAsMarkdown: vi.fn(async () => undefined),
    handleDownloadMarkdown: vi.fn(),
    isAuthenticated: false,
    isCompactSidebar: true,
    isFocusMode: false,
    isStreaming: true,
    isSwarmActive: false,
    isWideMode: false,
    runtimeOwnerReady: true,
    liveEvents: [
      {
        id: 'search-1-unified',
        status: 'running',
        title: 'webSearch',
      },
    ],
    messagesToRender: [],
    onClose: vi.fn(),
    setActiveThreadId: vi.fn(),
    setAttachedFiles: vi.fn(),
    setInput: vi.fn(),
    setIsFocusMode: vi.fn(),
    setIsMinimized: vi.fn(),
    setIsWideMode: vi.fn(),
    setShowEventsPanel: vi.fn(),
    setShowOverflowMenu: vi.fn(),
    setShowSkillsPanel: vi.fn(),
    setShowSidebar: vi.fn(),
    showSidebar: false,
    showOverflowMenu: false,
    swarmTasks: [],
    threads: [],
    ...overrides,
  };
}

describe('PanelHeader live event reachability', () => {
  it('keeps conversation history reachable from the focused header', () => {
    const setShowSidebar = vi.fn();
    render(<PanelHeader {...compactHeaderProps({ setShowSidebar })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Show conversations' }));
    expect(setShowSidebar).toHaveBeenCalledWith(expect.any(Function));
    const toggle = setShowSidebar.mock.calls[0]?.[0] as (previous: boolean) => boolean;
    expect(toggle(false)).toBe(true);
  });

  it('opens Live Events from the compact sidebar variant used by Cockpit', () => {
    const setShowEventsPanel = vi.fn();

    render(
      <PanelHeader
        {...compactHeaderProps({ setShowEventsPanel })}
      />
    );

    const button = screen.getByRole('button', { name: /open live events/i });
    expect(button).toHaveAttribute('aria-label', 'Open live events (1 running)');

    fireEvent.click(button);

    expect(setShowEventsPanel).toHaveBeenCalledTimes(1);
    expect(setShowEventsPanel).toHaveBeenCalledWith(expect.any(Function));
    const toggle = setShowEventsPanel.mock.calls[0]?.[0] as (
      previous: boolean
    ) => boolean;
    expect(toggle(false)).toBe(true);
  });

  it('does not add a dead compact control when no live events exist', () => {
    render(<PanelHeader {...compactHeaderProps({ liveEvents: [] })} />);

    expect(
      screen.queryByRole('button', { name: /open live events/i })
    ).not.toBeInTheDocument();
  });

  it('does not add a dead desktop Live Events control when no events exist', () => {
    render(
      <PanelHeader
        {...compactHeaderProps({
          isCompactSidebar: false,
          liveEvents: [],
          showOverflowMenu: true,
        })}
      />
    );

    expect(screen.queryByText('Live Events')).not.toBeInTheDocument();
  });

  it('shares canonical UIMessage text parts and hides sharing without assistant text', async () => {
    const appendToSignalsLog = vi.fn(async () => undefined);
    const { rerender } = render(
      <PanelHeader
        {...compactHeaderProps({
          activeThreadId: 'thread-1',
          appendToSignalsLog,
          isAuthenticated: true,
          isCompactSidebar: false,
          isStreaming: false,
          messagesToRender: [
            { role: 'assistant', parts: [{ type: 'text', text: 'Grounded UIMessage answer' }] },
          ],
          showOverflowMenu: true,
          threads: [{ _id: 'thread-1', title: 'Runtime thread' }],
        })}
      />
    );

    fireEvent.click(screen.getByText('Share to Signals'));
    expect(appendToSignalsLog).toHaveBeenCalledWith(expect.objectContaining({
      markdown: 'Grounded UIMessage answer',
    }));

    rerender(
      <PanelHeader
        {...compactHeaderProps({
          activeThreadId: 'thread-1',
          isAuthenticated: true,
          isCompactSidebar: false,
          messagesToRender: [{ role: 'user', parts: [{ type: 'text', text: 'Question' }] }],
          showOverflowMenu: true,
        })}
      />
    );
    expect(screen.queryByText('Share to Signals')).not.toBeInTheDocument();
  });

  it('keeps the header focused on controls backed by runtime behavior', () => {
    render(
      <PanelHeader
        {...compactHeaderProps({
          activeThreadId: 'thread-1',
          isCompactSidebar: false,
          isStreaming: false,
          messagesToRender: [{ content: 'Grounded answer', role: 'assistant' }],
          showOverflowMenu: true,
        })}
      />
    );

    expect(screen.getByText('Copy as Markdown')).toBeInTheDocument();
    expect(screen.getByText('Download .md')).toBeInTheDocument();
    expect(screen.queryByText(/system prompt/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: /persona/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/thread stats/i)).not.toBeInTheDocument();
  });

  it('labels owner readiness as session availability without implying runtime health', () => {
    const { rerender } = render(
      <PanelHeader
        {...compactHeaderProps({
          isStreaming: false,
          runtimeOwnerReady: true,
        })}
      />
    );

    expect(screen.getByLabelText('Session available')).toHaveClass('bg-content-muted');
    expect(screen.queryByLabelText('Runtime ready')).not.toBeInTheDocument();

    rerender(
      <PanelHeader
        {...compactHeaderProps({
          isStreaming: false,
          runtimeOwnerReady: false,
        })}
      />
    );

    expect(screen.getByLabelText('Session preparing')).toHaveClass('bg-content-muted');
    expect(screen.queryByLabelText('Runtime ready')).not.toBeInTheDocument();
  });
});
