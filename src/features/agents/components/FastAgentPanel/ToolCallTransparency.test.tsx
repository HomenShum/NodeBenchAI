import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ToolCallTransparency } from './ToolCallTransparency';

const stateCases = [
  {
    status: 'running' as const,
    primitiveState: 'input-available',
    primitiveLabel: 'Running',
  },
  {
    status: 'success' as const,
    primitiveState: 'output-available',
    primitiveLabel: 'Completed',
  },
  {
    status: 'error' as const,
    primitiveState: 'output-error',
    primitiveLabel: 'Error',
  },
];

describe('ToolCallTransparency', () => {
  it.each(stateCases)(
    'maps $status to the AI Elements $primitiveState state',
    ({ primitiveLabel, primitiveState, status }) => {
      const { container } = render(
        <ToolCallTransparency
          toolCalls={[{ status, toolName: 'convex_audit_schema' }]}
        />
      );

      expect(container.querySelector(`[data-tool-state="${primitiveState}"]`)).toBeInTheDocument();
      expect(screen.getByText(primitiveLabel)).toBeInTheDocument();
    }
  );

  it('preserves disclosure, input/output summaries, and complete QuickRef content', () => {
    render(
      <ToolCallTransparency
        toolCalls={[
          {
            durationMs: 1250,
            inputSummary: 'projectId=nodebench',
            outputSummary: '12 schema findings',
            quickRef: {
              confidence: 'high',
              methodology: 'Schema audit methodology',
              nextAction: 'Review the missing indexes.',
              nextTools: ['convex_suggest_indexes'],
              relatedGotchas: ['wide-scan', 'missing-index'],
            },
            status: 'success',
            toolName: 'convex_audit_schema',
          },
        ]}
      />
    );

    const trigger = screen.getByRole('button', { name: /audit schema/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('projectId=nodebench')).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('projectId=nodebench')).toBeInTheDocument();
    expect(screen.getByText('12 schema findings')).toBeInTheDocument();
    expect(screen.getByText('QuickRef')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('Review the missing indexes.')).toBeInTheDocument();
    expect(screen.getByText('convex_suggest_indexes')).toBeInTheDocument();
    expect(screen.getByText('wide-scan')).toBeInTheDocument();
    expect(screen.getByText('missing-index')).toBeInTheDocument();
    expect(screen.getByText('1.3s')).toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('projectId=nodebench')).not.toBeInTheDocument();
  });

  it('keeps compact mode non-disclosing while retaining tool names, timing, and mapped states', () => {
    const { container } = render(
      <ToolCallTransparency
        compact
        toolCalls={stateCases.map(({ status }, index) => ({
          durationMs: (index + 1) * 100,
          status,
          toolName: `convex_tool_${index + 1}`,
        }))}
      />
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('tool 1')).toBeInTheDocument();
    expect(screen.getByText('tool 2')).toBeInTheDocument();
    expect(screen.getByText('tool 3')).toBeInTheDocument();
    expect(screen.getByText('100ms')).toBeInTheDocument();
    expect(screen.getByText('200ms')).toBeInTheDocument();
    expect(screen.getByText('300ms')).toBeInTheDocument();
    for (const { primitiveState } of stateCases) {
      expect(container.querySelector(`[data-tool-state="${primitiveState}"]`)).toBeInTheDocument();
    }
  });

  it('renders nothing when no tool calls are present', () => {
    const { container } = render(<ToolCallTransparency toolCalls={[]} />);

    expect(container.firstChild).toBeNull();
  });
});
