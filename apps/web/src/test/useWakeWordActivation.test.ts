import { describe, expect, it } from 'vitest';
import { detectWakeWord } from '../hooks/useWakeWordActivation';

describe('detectWakeWord', () => {
  it('matches supported wake phrases', () => {
    expect(detectWakeWord('hey nodebench')).toBe('hey nodebench');
    expect(detectWakeWord('Hi NodeBench, open documents')).toBe('hi nodebench');
    expect(detectWakeWord('okay nodebench can you search')).toBe('okay nodebench');
  });

  it('ignores partial or unrelated phrases', () => {
    expect(detectWakeWord('nodebench')).toBeNull();
    expect(detectWakeWord('hey notebook')).toBeNull();
    expect(detectWakeWord('hello there')).toBeNull();
  });
});
