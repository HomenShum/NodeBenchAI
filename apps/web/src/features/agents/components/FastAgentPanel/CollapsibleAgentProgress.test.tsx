import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CollapsibleAgentProgress } from './CollapsibleAgentProgress';

const testState = vi.hoisted(() => ({
  prefersReducedMotion: false,
  timelineProps: null as Record<string, unknown> | null,
}));

vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => testState.prefersReducedMotion,
}));

vi.mock('./StepTimeline', () => ({
  toolPartsToTimelineSteps: (toolParts: unknown[]) =>
    toolParts.map((part, index) => ({ id: `step-${index}`, part })),
  StepTimeline: (props: Record<string, unknown>) => {
    testState.timelineProps = props;
    const steps = props.steps as unknown[];
    return <div data-testid="tool-timeline">Tool timeline: {steps.length}</div>;
  },
}));

const toolParts = [
  {
    type: 'tool-webSearch',
    state: 'input-available',
    input: { query: 'agent primitives' },
  },
  {
    type: 'tool-result-webSearch',
    state: 'output-available',
    output: { results: 2 },
  },
] as any;

describe('CollapsibleAgentProgress', () => {
  beforeEach(() => {
    testState.prefersReducedMotion = false;
    testState.timelineProps = null;
  });

  it('preserves the collapsed default and toggles the process disclosure', () => {
    render(<CollapsibleAgentProgress toolParts={toolParts} />);

    const trigger = screen.getByRole('button', { name: /agent progress/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('tool-timeline')).not.toBeInTheDocument();
    expect(screen.getByText(/click to view detailed agent actions/i)).toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('tool-timeline')).toHaveTextContent('Tool timeline: 2');

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('tool-timeline')).not.toBeInTheDocument();
  });

  it('keeps streaming, reasoning, tool steps, and selection callbacks connected', () => {
    const onCompanySelect = vi.fn();
    const onPersonSelect = vi.fn();
    const onEventSelect = vi.fn();
    const onNewsSelect = vi.fn();

    render(
      <CollapsibleAgentProgress
        defaultExpanded
        isStreaming
        onCompanySelect={onCompanySelect}
        onEventSelect={onEventSelect}
        onNewsSelect={onNewsSelect}
        onPersonSelect={onPersonSelect}
        reasoning="Compare the primary sources before answering."
        toolParts={toolParts}
      />
    );

    expect(screen.getByRole('button', { name: /agent working/i })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.getByText('Compare the primary sources before answering.')).toBeInTheDocument();
    expect(screen.getByTestId('tool-timeline')).toHaveTextContent('Tool timeline: 2');
    expect(testState.timelineProps).toMatchObject({
      isStreaming: true,
      onCompanySelect,
      onEventSelect,
      onNewsSelect,
      onPersonSelect,
    });
  });

  it('disables primitive transition and entrance motion when reduced motion is preferred', () => {
    testState.prefersReducedMotion = true;

    const { container } = render(
      <CollapsibleAgentProgress
        defaultExpanded
        isStreaming
        reasoning="Static reasoning"
        toolParts={toolParts}
      />
    );

    const reducedMotionSurfaces = container.querySelectorAll('[data-reduced-motion="true"]');
    expect(reducedMotionSurfaces).toHaveLength(3);
    for (const surface of reducedMotionSurfaces) {
      expect(surface).toHaveClass('!animate-none', '!transition-none', '!transform-none');
    }
  });

  it('renders nothing without reasoning or tool content', () => {
    const { container } = render(<CollapsibleAgentProgress toolParts={[]} />);

    expect(container.firstChild).toBeNull();
  });
});
