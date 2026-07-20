// src/components/FastAgentPanel/FastAgentPanel.MediaRecorder.tsx
// Media recording component for audio and video

import React, { useState, useRef, useEffect } from 'react';
import { Mic, Video, Square, Loader2 } from 'lucide-react';

const styles = `
  .media-recorder {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
    min-width: 300px;
  }
  
  .media-recorder.loading {
    align-items: center;
    text-align: center;
    padding: 2rem;
  }
  
  .media-recorder.error {
    align-items: center;
  }
  
  .spinner {
    width: 2rem;
    height: 2rem;
    color: var(--text-secondary);
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  .error-message {
    text-align: center;
  }
  
  .error-message p {
    color: #ef4444;
    margin-bottom: 1rem;
  }
  
  .recorder-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .mode-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 500;
    color: var(--text-primary);
  }
  
  .mode-label .icon {
    width: 1.25rem;
    height: 1.25rem;
  }
  
  .recording-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #ef4444;
    font-weight: 600;
  }
  
  .red-dot {
    width: 0.75rem;
    height: 0.75rem;
    background: #ef4444;
    border-radius: 50%;
    animation: pulse 1.5s ease-in-out infinite;
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  
  .video-preview {
    width: 100%;
    max-height: 300px;
    background: #000;
    border-radius: 0.5rem;
  }
  
  .audio-visualizer {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 150px;
  }
  
  .pulse-ring {
    position: absolute;
    width: 80px;
    height: 80px;
    border: 3px solid #3b82f6;
    border-radius: 50%;
    animation: pulse-ring 1.5s ease-out infinite;
  }
  
  @keyframes pulse-ring {
    0% {
      transform: scale(0.8);
      opacity: 1;
    }
    100% {
      transform: scale(1.5);
      opacity: 0;
    }
  }
  
  .mic-icon {
    width: 2.5rem;
    height: 2.5rem;
    color: #3b82f6;
    z-index: 1;
  }
  
  .recorder-controls {
    display: flex;
    gap: 0.75rem;
  }
  
  .recorder-controls button {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border: none;
    border-radius: 0.5rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }
  
  .recorder-controls button .icon {
    width: 1.25rem;
    height: 1.25rem;
  }
  
  .record-btn {
    background: #3b82f6;
    color: white;
  }
  
  .record-btn:hover {
    background: #2563eb;
  }
  
  .stop-btn {
    background: #ef4444;
    color: white;
  }
  
  .stop-btn:hover {
    background: #dc2626;
  }
  
  .cancel-btn,
  .close-btn {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  
  .cancel-btn:hover,
  .close-btn:hover {
    background: var(--bg-primary);
  }
`;

interface MediaRecorderProps {
  mode: 'audio' | 'video';
  onRecordingComplete: (blob: Blob, type: 'audio' | 'video') => void;
  onClose: () => void;
}

/**
 * MediaRecorder - Records audio or video from user's device
 */
export function MediaRecorderComponent({
  mode,
  onRecordingComplete,
  onClose,
}: MediaRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Request media permissions on mount
  useEffect(() => {
    let disposed = false;
    let mediaStream: MediaStream | null = null;

    const initMedia = async () => {
      try {
        const constraints = mode === 'video' 
          ? { video: true, audio: true }
          : { audio: true };
        
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (disposed) {
          mediaStream.getTracks().forEach(track => track.stop());
          mediaStream = null;
          return;
        }

        setStream(mediaStream);
        
        // Show video preview for video mode
        if (mode === 'video' && videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        console.error('Error accessing media devices:', err);
        setError(`Failed to access ${mode}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    };
    
    initMedia();
    
    // Cleanup
    return () => {
      disposed = true;
      if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [mode]);
  
  const startRecording = () => {
    if (!stream) return;
    
    chunksRef.current = [];
    const mimeType = mode === 'video' 
      ? 'video/webm;codecs=vp8,opus'
      : 'audio/webm;codecs=opus';
    
    try {
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        onRecordingComplete(blob, mode);
        onClose();
      };
      
      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      
      // Start timer
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Error starting recording:', err);
      setError(`Failed to start recording: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };
  
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };
  
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  if (error) {
    return (
      <div className="media-recorder error">
        <div className="error-message">
          <p>{error}</p>
          <button onClick={onClose} className="close-btn">
            Close
          </button>
        </div>
        <style>{styles}</style>
      </div>
    );
  }
  
  if (!stream) {
    return (
      <div className="media-recorder loading">
        <Loader2 className="spinner" />
        <p>Requesting {mode} permission...</p>
        <style>{styles}</style>
      </div>
    );
  }
  
  return (
    <div className="media-recorder">
      <div className="recorder-header">
        <div className="mode-label">
          {mode === 'video' ? <Video className="icon" /> : <Mic className="icon" />}
          <span>Recording {mode}</span>
        </div>
        {isRecording && (
          <div className="recording-indicator">
            <span className="red-dot" />
            {formatTime(recordingTime)}
          </div>
        )}
      </div>
      
      {mode === 'video' && (
        <video
          ref={videoRef}
          autoPlay
          muted
          className="video-preview"
        />
      )}
      
      {mode === 'audio' && isRecording && (
        <div className="audio-visualizer">
          <div className="pulse-ring" />
          <Mic className="mic-icon" />
        </div>
      )}
      
      <div className="recorder-controls">
        {!isRecording ? (
          <>
            <button onClick={startRecording} className="record-btn">
              {mode === 'video' ? <Video className="icon" /> : <Mic className="icon" />}
              Start Recording
            </button>
            <button onClick={onClose} className="cancel-btn">
              Cancel
            </button>
          </>
        ) : (
          <button onClick={stopRecording} className="stop-btn">
            <Square className="icon" />
            Stop & Save
          </button>
        )}
      </div>
      
      <style>{styles}</style>
    </div>
  );
}
