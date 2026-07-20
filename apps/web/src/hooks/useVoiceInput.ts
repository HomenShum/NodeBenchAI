/**
 * useVoiceInput - Dual-mode voice-to-text hook
 *
 * MODE 1: "browser" - Web Speech API with low-latency interim results
 * MODE 2: "whisper" - MediaRecorder -> server transcription
 *
 * Both modes now expose `audioLevel` so the UI can render a live mic meter.
 */

import { useState, useRef, useCallback } from 'react';
import { useAction } from 'convex/react';
import { api } from '@convex/_generated/api';
import { useStreamingTranscription } from './useStreamingTranscription';
import { useGeminiLiveSession } from './useGeminiLiveSession';

export type VoiceMode = 'browser' | 'whisper' | 'streaming' | 'gemini';

interface UseVoiceInputOptions {
    onTranscript: (text: string) => void;
    onEnd?: (finalText: string) => void;
    lang?: string;
    continuous?: boolean;
    mode?: VoiceMode;
}

interface UseVoiceInputReturn {
    isListening: boolean;
    isSupported: boolean;
    start: () => void;
    toggle: () => void;
    stop: () => void;
    mode: VoiceMode;
    isTranscribing: boolean;
    error: string | null;
    latencyMs: number | null;
    audioLevel: number;
    /** Streaming mode only: interim (unstable) text */
    interimText: string;
    /** Streaming mode only: accumulated stable text */
    stableText: string;
    /** Streaming mode only: speech state */
    speechState: string;
    /** Streaming mode only: confidence 0-1 */
    confidence: number;
}

export function useVoiceInput({
    onTranscript,
    onEnd,
    lang = 'en-US',
    continuous = true,
    mode = 'browser',
}: UseVoiceInputOptions): UseVoiceInputReturn {
    const [isListening, setIsListening] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [latencyMs, setLatencyMs] = useState<number | null>(null);
    const [audioLevel, setAudioLevel] = useState(0);

    const recognitionRef = useRef<any>(null);
    const finalTextRef = useRef('');
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const meterFrameRef = useRef<number | null>(null);
    const lastRealtimeCaptureRef = useRef<{ text: string; at: number } | null>(null);

    const whisperTranscribe = useAction(api.domains.ai.whisperTranscribe.transcribe);

    const recordRealtimeCapture = useCallback((finalText: string) => {
        const text = finalText.trim();
        if (!text || text === 'Listening...' || text === 'Transcribing...') return;

        const now = Date.now();
        const previous = lastRealtimeCaptureRef.current;
        if (previous && previous.text === text && now - previous.at < 2500) return;
        lastRealtimeCaptureRef.current = { text, at: now };

        const anonymousSessionId = getOrCreateRealtimeVoiceSessionId();
        const surface = inferRealtimeVoiceSurface();
        const idempotencyKey = `voice-${anonymousSessionId}-${now}-${hashClientString(text)}`;

        void fetch('/voice/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                anonymousSessionId,
                transcript: text,
                surface,
                idempotencyKey,
            }),
        }).catch(() => undefined);
    }, []);

    const handleFinalText = useCallback((finalText: string) => {
        onEnd?.(finalText);
        recordRealtimeCapture(finalText);
    }, [onEnd, recordRealtimeCapture]);

    // Streaming transcription (OpenAI Realtime via WebRTC — legacy)
    const streaming = useStreamingTranscription({
        onTranscript,
        onUtterance: handleFinalText,
        onEnd: handleFinalText,
        lang: lang.split('-')[0],
    });

    // Gemini 3.1 Flash Live (primary voice mode)
    const gemini = useGeminiLiveSession({
        onTranscript,
        onUtterance: handleFinalText,
        onEnd: handleFinalText,
        lang: lang.split('-')[0],
    });

    const hasSpeechApi = typeof window !== 'undefined' &&
        !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    const hasMediaRecorder = typeof window !== 'undefined' && !!window.MediaRecorder;
    const isSupported = mode === 'gemini'
        ? true // WebSocket + getUserMedia — universally supported
        : mode === 'streaming'
        ? streaming.isSupported
        : mode === 'browser' ? hasSpeechApi : hasMediaRecorder;

    const stopAudioMeter = useCallback(() => {
        if (meterFrameRef.current !== null) {
            cancelAnimationFrame(meterFrameRef.current);
            meterFrameRef.current = null;
        }
        try {
            sourceRef.current?.disconnect();
        } catch {
            // Ignore disconnect issues from partially initialized nodes.
        }
        try {
            analyserRef.current?.disconnect();
        } catch {
            // Ignore disconnect issues from partially initialized nodes.
        }
        sourceRef.current = null;
        analyserRef.current = null;
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            void audioContextRef.current.close().catch(() => undefined);
        }
        audioContextRef.current = null;
        setAudioLevel(0);
    }, []);

    const stopMediaStream = useCallback(() => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
    }, []);

    const startAudioMeter = useCallback(async (stream: MediaStream) => {
        if (typeof window === 'undefined') return;
        const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextCtor) return;

        stopAudioMeter();

        try {
            const ctx = new AudioContextCtor();
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.82;

            const source = ctx.createMediaStreamSource(stream);
            source.connect(analyser);

            audioContextRef.current = ctx;
            analyserRef.current = analyser;
            sourceRef.current = source;

            const data = new Uint8Array(analyser.fftSize);
            const updateLevel = () => {
                if (!analyserRef.current) return;
                analyserRef.current.getByteTimeDomainData(data);

                let sumSquares = 0;
                for (let i = 0; i < data.length; i += 1) {
                    const normalized = (data[i] - 128) / 128;
                    sumSquares += normalized * normalized;
                }

                const rms = Math.sqrt(sumSquares / data.length);
                const boosted = Math.min(1, rms * 4.2);
                setAudioLevel((current) => Math.max(boosted, current * 0.72));
                meterFrameRef.current = requestAnimationFrame(updateLevel);
            };

            updateLevel();
        } catch {
            setAudioLevel(0);
        }
    }, [stopAudioMeter]);

    const stopBrowser = useCallback(() => {
        if (recognitionRef.current) {
            recognitionRef.current.stop();
            recognitionRef.current = null;
        }
        stopMediaStream();
        stopAudioMeter();
        setIsListening(false);
    }, [stopAudioMeter, stopMediaStream]);

    const toggleBrowser = useCallback(async () => {
        if (isListening) {
            stopBrowser();
            return;
        }

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) return;

        setError(null);
        finalTextRef.current = '';

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000,
                },
            });
            streamRef.current = stream;
            await startAudioMeter(stream);
        } catch (err: any) {
            setError(err?.message || 'Microphone access denied');
            stopMediaStream();
            stopAudioMeter();
            setIsListening(false);
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = continuous;
        recognition.interimResults = true;
        recognition.lang = lang;

        recognition.onresult = (event: any) => {
            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = 0; i < event.results.length; i += 1) {
                const result = event.results[i];
                if (result.isFinal) {
                    finalTranscript += result[0].transcript;
                } else {
                    interimTranscript += result[0].transcript;
                }
            }

            finalTextRef.current = finalTranscript;
            onTranscript(finalTranscript + interimTranscript);
        };

        recognition.onerror = (event: any) => {
            setIsListening(false);
            recognitionRef.current = null;
            stopMediaStream();
            stopAudioMeter();
            if (event?.error !== 'aborted') {
                setError(`Speech error: ${event?.error ?? 'unknown'}`);
            }
        };

        recognition.onend = () => {
            setIsListening(false);
            recognitionRef.current = null;
            stopMediaStream();
            stopAudioMeter();
            handleFinalText(finalTextRef.current);
        };

        recognitionRef.current = recognition;
        try {
            recognition.start();
            setIsListening(true);
        } catch (err: any) {
            recognitionRef.current = null;
            stopMediaStream();
            stopAudioMeter();
            setError(err?.message || 'Speech recognition failed to start');
            setIsListening(false);
        }
    }, [continuous, handleFinalText, isListening, lang, onTranscript, startAudioMeter, stopAudioMeter, stopBrowser, stopMediaStream]);

    const stopWhisper = useCallback(async () => {
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state !== 'inactive') {
            recorder.stop();
        }
    }, []);

    const toggleWhisper = useCallback(async () => {
        if (isListening) {
            stopWhisper();
            return;
        }

        setError(null);
        setLatencyMs(null);

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000,
                },
            });
            streamRef.current = stream;
            await startAudioMeter(stream);

            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : MediaRecorder.isTypeSupported('audio/webm')
                    ? 'audio/webm'
                    : 'audio/mp4';

            const recorder = new MediaRecorder(stream, { mimeType });
            mediaRecorderRef.current = recorder;
            audioChunksRef.current = [];

            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunksRef.current.push(event.data);
            };

            recorder.onstop = async () => {
                stopMediaStream();
                stopAudioMeter();
                setIsListening(false);

                const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
                audioChunksRef.current = [];

                if (audioBlob.size < 1000) {
                    setError('No speech detected - try speaking louder or closer to the mic');
                    onTranscript('');
                    handleFinalText('');
                    return;
                }

                onTranscript('Transcribing...');
                setIsTranscribing(true);

                try {
                    const arrayBuffer = await audioBlob.arrayBuffer();
                    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

                    const result = await whisperTranscribe({
                        audioBase64: base64,
                        mimeType: mimeType.split(';')[0],
                        language: lang.split('-')[0],
                    });

                    setLatencyMs(result.durationMs);
                    onTranscript(result.text);
                    handleFinalText(result.text);
                } catch (err: any) {
                    const msg = err?.message || 'Transcription failed';
                    setError(msg);
                    onTranscript('');
                    handleFinalText('');
                } finally {
                    setIsTranscribing(false);
                }
            };

            recorder.start(250);
            setIsListening(true);
            onTranscript('Listening...');
        } catch (err: any) {
            setError(err?.message || 'Microphone access denied');
            stopMediaStream();
            stopAudioMeter();
            setIsListening(false);
        }
    }, [handleFinalText, isListening, lang, onTranscript, startAudioMeter, stopAudioMeter, stopMediaStream, stopWhisper, whisperTranscribe]);

    const toggle = mode === 'gemini' ? gemini.toggle : mode === 'streaming' ? streaming.toggle : mode === 'browser' ? toggleBrowser : toggleWhisper;

    const start = useCallback(() => {
        if (isListening || isTranscribing) return;
        if (mode === 'gemini') {
            gemini.start();
            return;
        }
        if (mode === 'streaming') {
            streaming.start();
            return;
        }
        if (mode === 'browser') {
            void toggleBrowser();
            return;
        }
        void toggleWhisper();
    }, [isListening, isTranscribing, mode, gemini, streaming, toggleBrowser, toggleWhisper]);

    const stop = useCallback(() => {
        if (mode === 'gemini') {
            gemini.stop();
            return;
        }
        if (mode === 'streaming') {
            streaming.stop();
            return;
        }
        if (mode === 'browser') {
            stopBrowser();
            return;
        }
        void stopWhisper();
    }, [mode, gemini, streaming, stopBrowser, stopWhisper]);

    // Delegate state based on active mode
    const isGemini = mode === 'gemini';
    const isStreaming = mode === 'streaming';
    const effectiveListening = isGemini ? gemini.isActive : isStreaming ? streaming.isListening : isListening;
    const effectiveAudioLevel = isGemini ? gemini.audioLevel : isStreaming ? streaming.audioLevel : audioLevel;
    const effectiveError = isGemini ? gemini.error : isStreaming ? streaming.error : error;
    const effectiveLatency = isGemini ? gemini.latencyMs : isStreaming ? streaming.latencyMs : latencyMs;

    return {
        isListening: effectiveListening,
        isSupported,
        start,
        toggle,
        stop,
        mode,
        isTranscribing: isGemini
            ? gemini.speechState === 'connecting'
            : isStreaming ? streaming.speechState === 'connecting' : isTranscribing,
        error: effectiveError,
        latencyMs: effectiveLatency,
        audioLevel: effectiveAudioLevel,
        // Streaming fields (Gemini or OpenAI)
        interimText: isGemini ? gemini.interimText : isStreaming ? streaming.interimText : '',
        stableText: isGemini ? gemini.stableText : isStreaming ? streaming.stableText : '',
        speechState: isGemini ? gemini.speechState : isStreaming ? streaming.speechState : 'idle',
        confidence: isGemini ? gemini.confidence : isStreaming ? streaming.confidence : 0,
    };
}

function getOrCreateRealtimeVoiceSessionId(): string {
    if (typeof window === 'undefined') return 'server';
    const key = 'nodebench-realtime-voice-session';
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const next =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    window.localStorage.setItem(key, next);
    return next;
}

function inferRealtimeVoiceSurface(): string {
    if (typeof window === 'undefined') return 'unknown';
    const url = new URL(window.location.href);
    if (url.pathname.includes('workspace') || url.search.includes('workspace')) return 'report';
    if (url.pathname.includes('chat') || url.search.includes('surface=chat')) return 'chat';
    if (url.pathname.includes('inbox') || url.search.includes('surface=inbox')) return 'event';
    if (url.pathname.includes('redesign')) return 'home';
    return 'home';
}

function hashClientString(value: string): string {
    let hash = 5381;
    for (let i = 0; i < value.length; i += 1) {
        hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}
