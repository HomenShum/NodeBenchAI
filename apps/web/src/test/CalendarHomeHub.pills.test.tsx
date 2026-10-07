// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, fireEvent } from '@testing-library/react';
import { buildCockpitPath } from '@/lib/registry/viewRegistry';
import { renderWithRouter } from './testUtils';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('convex/react', async () => {
  const actual: any = await vi.importActual('convex/react');
  return {
    ...actual,
    useQuery: () => undefined,
    useMutation: () => vi.fn(),
    useAction: () => vi.fn(),
    useConvex: () => ({ query: vi.fn(), mutation: vi.fn(), action: vi.fn() }),
  };
});
vi.mock('@/features/calendar/views/CalendarView', () => ({ CalendarView: () => <div /> }));
vi.mock('@/components/shared/SidebarMiniCalendar', () => ({ SidebarMiniCalendar: () => <div /> }));
vi.mock('@/components/shared/SidebarUpcoming', () => ({ SidebarUpcoming: () => <div /> }));
vi.mock('@/components/shared/TopDividerBar', () => ({ TopDividerBar: (p: any) => <div>{p.left}{p.right}</div> }));
vi.mock('@/components/agentDashboard/AgentDashboard', () => ({ AgentDashboard: () => <div /> }));

import { CalendarHomeHub } from '@/features/calendar/components/CalendarHomeHub';

describe('CalendarHomeHub pills + hash sync', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    navigateMock.mockReset();
    try {
      window.location.hash = '';
    } catch {
      // Hash reset failed
    }
  });

  it('defaults to Schedule active', () => {
    renderWithRouter(<CalendarHomeHub onDocumentSelect={() => {}} />);
    const schedule = screen.getByRole('tab', { name: 'Schedule' });
    expect(schedule.getAttribute('aria-selected')).toBe('true');
  });

  it('clicking Agents navigates to the workspace agents route', () => {
    renderWithRouter(<CalendarHomeHub onDocumentSelect={() => {}} />);
    const agents = screen.getByRole('tab', { name: 'Agents' });
    fireEvent.click(agents);
    expect(navigateMock).toHaveBeenCalledWith(
      buildCockpitPath({ surfaceId: 'workspace' as any, extra: { view: 'agents' } }),
    );
  });
});
