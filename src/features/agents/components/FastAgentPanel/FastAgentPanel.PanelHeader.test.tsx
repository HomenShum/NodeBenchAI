import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

function compactHeaderProps(
  overrides: Partial<PanelHeaderProps> = {}
): PanelHeaderProps {
  return {
    activePersona: 'general',
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
    liveEvents: [
      {
        id: 'search-1-unified',
        status: 'running',
        title: 'webSearch',
      },
    ],
    messagesToRender: [],
    onClose: vi.fn(),
    personas: [{ icon: 'N', id: 'general', name: 'General' }],
    selectedModel: 'default',
    setActivePersona: vi.fn(),
    setActiveThreadId: vi.fn(),
    setAttachedFiles: vi.fn(),
    setInput: vi.fn(),
    setIsFocusMode: vi.fn(),
    setIsMinimized: vi.fn(),
    setIsWideMode: vi.fn(),
    setShowAnalytics: vi.fn(),
    setShowEventsPanel: vi.fn(),
    setShowOverflowMenu: vi.fn(),
    setShowPersonaPicker: vi.fn(),
    setShowSkillsPanel: vi.fn(),
    setShowSystemPrompt: vi.fn(),
    setShowTimeline: vi.fn(),
    showOverflowMenu: false,
    showPersonaPicker: false,
    swarmTasks: [],
    systemPrompt: '',
    threads: [],
    ...overrides,
  };
}

describe('PanelHeader live event reachability', () => {
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
});
