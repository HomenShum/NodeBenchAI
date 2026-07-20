import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const panelDirectory = join(
  process.cwd(),
  'src/features/agents/components/FastAgentPanel',
);
const legacyBubblePath = join(panelDirectory, 'FastAgentPanel.MessageBubble.tsx');
const legacyStreamPath = join(panelDirectory, 'FastAgentPanel.MessageStream.tsx');
const unusedUiStreamPath = join(panelDirectory, 'FastAgentPanel.UIMessageStream.tsx');

describe('FastAgent removed UI guard', () => {
  test('keeps the unreachable legacy renderer island deleted', () => {
    expect(existsSync(legacyBubblePath)).toBe(false);
    expect(existsSync(legacyStreamPath)).toBe(false);
    expect(existsSync(unusedUiStreamPath)).toBe(false);
  });

  test('does not recreate fake clipboard sharing or inferred follow-ups in the active renderer', () => {
    const activeBubble = readFileSync(join(panelDirectory, 'FastAgentPanel.UIMessageBubble.tsx'), 'utf8');

    expect(activeBubble).not.toContain('Shared from AI Assistant');
    expect(activeBubble).not.toContain('generateFollowUps');
  });

  test('does not restore the write-only snapshot command or unlimited-access claim', () => {
    const panel = readFileSync(join(panelDirectory, 'FastAgentPanel.tsx'), 'utf8');
    const overlays = readFileSync(join(panelDirectory, 'FastAgentPanel.PanelOverlays.tsx'), 'utf8');

    expect(panel).not.toContain('fa_snapshots');
    expect(overlays).not.toContain('Save Snapshot');
    expect(`${panel}\n${overlays}`).not.toMatch(/unlimited access/i);
  });
});
