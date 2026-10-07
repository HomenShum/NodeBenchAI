// @vitest-environment jsdom
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('convex/react', async () => {
  const actual: any = await vi.importActual('convex/react');
  return {
    ...actual,
    useQuery: (fn: any, args: any) => {
      if (String(fn?.toString()).includes('agentTimelines.listForUser')) {
        return [{ timelineId: 'tl1' as any, title: 'Agents Hub', updatedAt: Date.now() }];
      }
      if (String(fn?.toString()).includes('agentTimelines.getByTimelineId')) {
        return { baseStartMs: Date.now() - 10000, tasks: [], links: [] } as any;
      }
      return undefined;
    },
    useMutation: () => async () => undefined,
    useConvex: () => ({ query: vi.fn(), mutation: vi.fn() }),
  };
});

import { CalendarHomeHub } from '@/features/calendar/components/CalendarHomeHub';


describe('CalendarHomeHub Agents deep-link', () => {
  it.skip('opens Agents subview when hash is #calendar/agents', () => {
    window.location.hash = '#calendar/agents';
    render(<CalendarHomeHub onDocumentSelect={() => {}} />);
    expect(screen.getByText('Timeline & Tasks')).toBeInTheDocument();
  });
});

