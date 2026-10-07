import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWakeVoiceFeedback } from '../hooks/useWakeVoiceFeedback';

class MockSpeechSynthesisUtterance {
  text: string;
  lang = 'en-US';
  pitch = 1;
  rate = 1;
  volume = 1;
  onend: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

describe('useWakeVoiceFeedback', () => {
  const cancel = vi.fn();
  const speak = vi.fn();

  beforeEach(() => {
    speak.mockReset();
    cancel.mockReset();

    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      writable: true,
      value: MockSpeechSynthesisUtterance,
    });

    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      writable: true,
      value: {
        cancel,
        speak,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('speaks the wake confirmation before voice capture starts', async () => {
    speak.mockImplementation((utterance: MockSpeechSynthesisUtterance) => {
      window.setTimeout(() => {
        utterance.onend?.(new Event('end'));
      }, 10);
    });

    const { result } = renderHook(() => useWakeVoiceFeedback());

    await act(async () => {
      await expect(result.current.speakWakeConfirmation()).resolves.toBe(true);
    });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][0].text).toBe('NodeBench is listening.');
  });

  it('returns false when speech synthesis is unavailable', async () => {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const { result } = renderHook(() => useWakeVoiceFeedback());

    await act(async () => {
      await expect(result.current.speakWakeConfirmation()).resolves.toBe(false);
    });
  });
});
