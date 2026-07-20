// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import { renderWithRouter } from './testUtils';

import { UnifiedHubPills } from '@shared/ui/UnifiedHubPills';

describe('DocumentsHomeHub header pills', () => {
  afterEach(() => cleanup());

  it('renders the unified pill group with Documents active', () => {
    renderWithRouter(<UnifiedHubPills active="documents" />);
    const tablist = screen.getAllByRole('tablist', { name: 'Primary hubs' })[0];
    expect(tablist).toBeTruthy();
    const docs = screen.getAllByRole('tab', { name: 'Documents' })[0];
    expect(docs.getAttribute('aria-selected')).toBe('true');
  });
});
