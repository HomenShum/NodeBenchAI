import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWakeVoiceSession } from '../hooks/useWakeVoiceSession';

describe('useWakeVoiceSession', () => {
  it('holds a stable wake state while acknowledgement and capture handoff run', async () => {
    const startVoiceCapture = vi.fn();
    const speakWakeConfirmation = vi.fn().mockResolvedValue(true);

    const { result, rerender } = renderHook(
      ({ isListening, isTranscribing }) =>
        useWakeVoiceSession({
          isListening,
          isTranscribing,
          startVoiceCapture,
          speakWakeConfirmation,
        }),
      {
        initialProps: {
          isListening: false,
          isTranscribing: false,
        },
      },
    );

    await act(async () => {
      await result.current.beginWakeSession();
    });

    expect(speakWakeConfirmation).toHaveBeenCalledTimes(1);
    expect(startVoiceCapture).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('starting');
    expect(result.current.isActive).toBe(true);

    rerender({ isListening: true, isTranscribing: false });

    await waitFor(() => {
      expect(result.current.phase).toBe('active');
    });
  });
});
