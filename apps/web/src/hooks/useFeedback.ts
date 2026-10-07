/**
 * useFeedback Hook
 * Provides audio/visual micro-feedback for successful or failed actions.
 * Uses Web Audio API for sounds and CSS animations for visual cues.
 */

import { useCallback, useRef } from 'react';

// Pre-defined frequencies for feedback sounds
const SUCCESS_FREQ = [523.25, 659.25, 783.99]; // C5 -> E5 -> G5 (Major chord arpeggio)
const ERROR_FREQ = [392, 349.23]; // G4 -> F4 (Descending minor 2nd)

interface FeedbackOptions {
    /** Target element to apply visual animation */
    targetRef?: React.RefObject<HTMLElement>;
    /** Duration of the sound in milliseconds */
    duration?: number;
    /** Volume from 0 to 1 */
    volume?: number;
}

export function useFeedback() {
    const audioContextRef = useRef<AudioContext | null>(null);

    const getAudioContext = useCallback(() => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        return audioContextRef.current;
    }, []);

    const playTone = useCallback((frequencies: number[], options: FeedbackOptions = {}) => {
        const { duration = 100, volume = 0.15 } = options;

        try {
            const ctx = getAudioContext();
            const now = ctx.currentTime;

            frequencies.forEach((freq, i) => {
                const oscillator = ctx.createOscillator();
                const gainNode = ctx.createGain();

                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(freq, now);

                // Envelope: quick attack, short sustain, quick release
                gainNode.gain.setValueAtTime(0, now + (i * duration) / 1000);
                gainNode.gain.linearRampToValueAtTime(volume, now + (i * duration) / 1000 + 0.02);
                gainNode.gain.linearRampToValueAtTime(0, now + ((i + 1) * duration) / 1000);

                oscillator.connect(gainNode);
                gainNode.connect(ctx.destination);

                oscillator.start(now + (i * duration) / 1000);
                oscillator.stop(now + ((i + 1) * duration) / 1000 + 0.05);
            });
        } catch (e) {
            // Silently fail if Web Audio API is not supported
            console.warn('[useFeedback] Audio playback failed:', e);
        }
    }, [getAudioContext]);

    const triggerSuccess = useCallback((options: FeedbackOptions = {}) => {
        // Audio feedback
        playTone(SUCCESS_FREQ, { ...options, duration: options.duration ?? 80 });

        // Visual feedback (flash animation)
        if (options.targetRef?.current) {
            const el = options.targetRef.current;
            el.classList.add('feedback-success-flash');
            setTimeout(() => el.classList.remove('feedback-success-flash'), 600);
        }
    }, [playTone]);

    const triggerError = useCallback((options: FeedbackOptions = {}) => {
        // Audio feedback
        playTone(ERROR_FREQ, { ...options, duration: options.duration ?? 150 });

        // Visual feedback (shake animation)
        if (options.targetRef?.current) {
            const el = options.targetRef.current;
            el.classList.add('feedback-error-shake');
            setTimeout(() => el.classList.remove('feedback-error-shake'), 500);
        }
    }, [playTone]);

    return { triggerSuccess, triggerError };
}

export default useFeedback;
