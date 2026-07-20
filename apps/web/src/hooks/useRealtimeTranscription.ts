import { useAction } from 'convex/react';
import { useCallback, useRef, useState } from 'react';
import { api } from '../../convex/_generated/api';

interface UseRealtimeTranscriptionOptions {
    onTranscript: (text: string) => void;
    onEnd?: (finalText: string) => void;
    lang?: string;
}

interface UseRealtimeTranscriptionReturn {
    isListening: boolean;
    isSupported: boolean;
    start: () => Promise<boolean>;
    stop: () => void;
    toggle: () => Promise<boolean>;
    isTranscribing: boolean;
    error: string | null;
    audioLevel: number;
}

type TranscriptState = {
    finalText: string;
    interimText: string;
};

function mergeTranscriptState(state: TranscriptState) {
    return `${state.finalText}${state.interimText}`.trim();
}

export function useRealtimeTranscription({
    onTranscript,
    onEnd,
    lang = 'en-US',
}: UseRealtimeTranscriptionOptions): UseRealtimeTranscriptionReturn {
    const startCall = useAction(api.domains.ai.realtimeTranscription.startRealtimeTranscriptionCall);

    const [isListening, setIsListening] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [audioLevel, setAudioLevel] = useState(0);

    const peerRef = useRef<RTCPeerConnection | null>(null);
    const dataChannelRef = useRef<RTCDataChannel | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const meterFrameRef = useRef<number | null>(null);
    const transcriptRef = useRef<TranscriptState>({ finalText: '', interimText: '' });
    const completedRef = useRef(false);

    const isSupported =
        typeof window !== 'undefined' &&
        !!navigator.mediaDevices?.getUserMedia &&
        !!window.RTCPeerConnection;

    const stopAudioMeter = useCallback(() => {
        if (meterFrameRef.current !== null) {
            cancelAnimationFrame(meterFrameRef.current);
            meterFrameRef.current = null;
        }
        try {
            sourceRef.current?.disconnect();
        } catch {
            // ignore
        }
        try {
            analyserRef.current?.disconnect();
        } catch {
            // ignore
        }
        sourceRef.current = null;
        analyserRef.current = null;
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            void audioContextRef.current.close().catch(() => undefined);
        }
        audioContextRef.current = null;
        setAudioLevel(0);
    }, []);

    const stopStream = useCallback(() => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
    }, []);

    const stop = useCallback(() => {
        completedRef.current = true;
        try {
            dataChannelRef.current?.close();
        } catch {
            // ignore
        }
        try {
            peerRef.current?.close();
        } catch {
            // ignore
        }
        dataChannelRef.current = null;
        peerRef.current = null;
        stopStream();
        stopAudioMeter();
        setIsListening(false);
        setIsTranscribing(false);
    }, [stopAudioMeter, stopStream]);

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
            const tick = () => {
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
                meterFrameRef.current = requestAnimationFrame(tick);
            };
            tick();
        } catch {
            setAudioLevel(0);
        }
    }, [stopAudioMeter]);

    const handleRealtimeEvent = useCallback((payload: any) => {
        switch (payload?.type) {
            case 'input_audio_buffer.speech_started':
                setIsListening(true);
                setIsTranscribing(false);
                return;
            case 'input_audio_buffer.speech_stopped':
                setIsTranscribing(true);
                return;
            case 'conversation.item.input_audio_transcription.delta':
                transcriptRef.current = {
                    ...transcriptRef.current,
                    interimText: `${transcriptRef.current.interimText}${payload.delta ?? ''}`,
                };
                onTranscript(mergeTranscriptState(transcriptRef.current));
                return;
            case 'conversation.item.input_audio_transcription.completed': {
                const transcript = payload.transcript || mergeTranscriptState(transcriptRef.current);
                transcriptRef.current = {
                    finalText: transcript,
                    interimText: '',
                };
                onTranscript(transcript);
                onEnd?.(transcript);
                completedRef.current = true;
                setIsTranscribing(false);
                setIsListening(false);
                window.setTimeout(() => stop(), 120);
                return;
            }
            case 'error':
                setError(payload?.error?.message || payload?.message || 'Realtime transcription failed');
                setIsTranscribing(false);
                setIsListening(false);
                return;
            default:
                return;
        }
    }, [onEnd, onTranscript, stop]);

    const start = useCallback(async () => {
        if (!isSupported) return false;
        if (peerRef.current || isListening || isTranscribing) return true;

        completedRef.current = false;
        transcriptRef.current = { finalText: '', interimText: '' };
        setError(null);
        setIsTranscribing(false);

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 24000,
                },
            });
            streamRef.current = stream;
            await startAudioMeter(stream);

            const peer = new RTCPeerConnection();
            peerRef.current = peer;

            const dataChannel = peer.createDataChannel('oai-events');
            dataChannelRef.current = dataChannel;
            dataChannel.addEventListener('message', (event) => {
                try {
                    const payload = JSON.parse(String(event.data));
                    handleRealtimeEvent(payload);
                } catch {
                    // ignore malformed transport events
                }
            });

            peer.addEventListener('connectionstatechange', () => {
                if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
                    if (!completedRef.current) {
                        setError('Realtime connection dropped');
                    }
                    stop();
                }
            });

            for (const track of stream.getTracks()) {
                peer.addTrack(track, stream);
            }

            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);

            const localOffer = peer.localDescription?.sdp;
            if (!localOffer) {
                throw new Error('No local SDP offer created');
            }

            const result = await startCall({
                offerSdp: localOffer,
                language: lang.split('-')[0],
            });

            await peer.setRemoteDescription({
                type: 'answer',
                sdp: result.answerSdp,
            });

            setIsListening(true);
            return true;
        } catch (err: any) {
            setError(err?.message || 'Realtime transcription failed to start');
            stop();
            return false;
        }
    }, [handleRealtimeEvent, isListening, isSupported, isTranscribing, lang, startAudioMeter, startCall, stop]);

    const toggle = useCallback(async () => {
        if (peerRef.current || isListening || isTranscribing) {
            stop();
            return true;
        }
        return await start();
    }, [isListening, isTranscribing, start, stop]);

    return {
        isListening,
        isSupported,
        start,
        stop,
        toggle,
        isTranscribing,
        error,
        audioLevel,
    };
}
