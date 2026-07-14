import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LiveEventCard,
  type LiveEvent,
  type LiveEventStatus,
  type LiveEventType,
} from './LiveEventCard';

const motionState = vi.hoisted(() => ({ reduced: false }));

vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => motionState.reduced,
}));

const makeEvent = (overrides: Partial<LiveEvent> = {}): LiveEvent => ({
  details: 'Fetched three grounded sources.',
  duration: 1250,
  id: 'event-1',
  status: 'running',
  timestamp: new Date('2026-07-14T12:34:56Z').getTime(),
  title: 'Search primary sources',
  toolName: 'web_search',
  type: 'tool_start',
  ...overrides,
});

const stateCases: Array<{
  status: LiveEventStatus;
  primitiveState: string;
  label: string;
}> = [
  { status: 'running', primitiveState: 'input-available', label: 'Running' },
  { status: 'success', primitiveState: 'output-available', label: 'Completed' },
  { status: 'error', primitiveState: 'output-error', label: 'Error' },
  { status: 'denied', primitiveState: 'output-denied', label: 'Denied' },
  { status: 'pending', primitiveState: 'input-streaming', label: 'Pending' },
];

const iconCases: Array<{
  type: LiveEventType;
  toolName?: string;
  iconKind: string;
}> = [
  { type: 'tool_start', toolName: 'web_search', iconKind: 'search' },
  { type: 'tool_end', toolName: 'create_document', iconKind: 'document' },
  { type: 'tool_error', toolName: 'memory_lookup', iconKind: 'memory' },
  { type: 'agent_spawn', iconKind: 'agent' },
  { type: 'agent_complete', iconKind: 'agent' },
  { type: 'thinking', iconKind: 'thinking' },
  { type: 'memory_read', iconKind: 'memory' },
  { type: 'memory_write', iconKind: 'memory' },
  { type: 'step_complete', iconKind: 'step' },
];

describe('LiveEventCard', () => {
  beforeEach(() => {
    motionState.reduced = false;
  });

  it.each(stateCases)(
    'maps $status to the live Tool state $primitiveState',
    ({ label, primitiveState, status }) => {
      const { container } = render(<LiveEventCard event={makeEvent({ status })} />);

      expect(container.querySelector(`[data-tool-state="${primitiveState}"]`)).toBeInTheDocument();
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  );

  it.each(iconCases)(
    'keeps the $type domain renderer as $iconKind',
    ({ iconKind, toolName, type }) => {
      const { container } = render(
        <LiveEventCard event={makeEvent({ toolName, type })} showTimeline={false} />
      );

      expect(container.querySelector(`[data-event-icon="${iconKind}"]`)).toBeInTheDocument();
    }
  );

  it('is expanded by default and preserves metadata while details are disclosed', () => {
    render(
      <LiveEventCard
        event={makeEvent({
          agentName: 'Research Agent',
          status: 'success',
        })}
      />
    );

    const trigger = screen.getByRole('button', { name: /search primary sources/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Fetched three grounded sources.')).toBeInTheDocument();
    expect(screen.getByText('web_search')).toBeInTheDocument();
    expect(screen.getByText('Research Agent')).toBeInTheDocument();
    expect(screen.getByText('1.3s')).toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Fetched three grounded sources.')).not.toBeInTheDocument();
    expect(screen.getByText('web_search')).toBeInTheDocument();
    expect(screen.getByText('Research Agent')).toBeInTheDocument();
    expect(screen.getByText('1.3s')).toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Fetched three grounded sources.')).toBeInTheDocument();
  });

  it('preserves timeline connector and last-item behavior', () => {
    const { container, rerender } = render(
      <LiveEventCard event={makeEvent()} isLast={false} showTimeline />
    );

    expect(container.querySelector('[data-live-event-connector]')).toBeInTheDocument();
    expect(container.querySelector('[data-live-event-dot]')).toBeInTheDocument();

    rerender(<LiveEventCard event={makeEvent()} isLast showTimeline />);

    expect(container.querySelector('[data-live-event-connector]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-live-event-dot]')).toBeInTheDocument();

    rerender(<LiveEventCard event={makeEvent()} isLast showTimeline={false} />);

    expect(container.querySelector('[data-live-event-connector]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-live-event-dot]')).not.toBeInTheDocument();
  });

  it('removes primitive and card motion when reduced motion is preferred', () => {
    motionState.reduced = true;

    const { container } = render(<LiveEventCard event={makeEvent()} />);

    const reducedMotionSurfaces = container.querySelectorAll('[data-reduced-motion="true"]');
    expect(reducedMotionSurfaces).toHaveLength(2);
    for (const surface of reducedMotionSurfaces) {
      expect(surface).toHaveClass('!animate-none', '!transform-none', '!transition-none');
    }
  });
});
