/**
 * HUD Components — Agent interface UI effects
 *
 * Usage:
 * import { CursorGlow, GridOverlay, ScanLine, HUDPanel } from '@/components/hud';
 * import { JarvisHUDLayout, TypewriterText } from '@/components/hud';
 * import { useAgentThread, useHUDLayout } from '@/components/hud';
 */

// Ambient Effects
export { CursorGlow } from './CursorGlow';
export { GridOverlay, GridOverlayStyles } from './GridOverlay';
export { ScanLine } from './ScanLine';
export { HUDPanel } from './HUDPanel';

// Agent HUD Layout System
export { JarvisHUDLayout } from './JarvisHUDLayout';
export type { VoiceMode } from '../../hooks/useVoiceInput';
export { TypewriterText } from './TypewriterText';

// Headless Hooks
export { useAgentThread } from './useAgentThread';
export type { AgentMessage, ThreadState, UseAgentThreadOptions } from './useAgentThread';
export { useHUDLayout } from './useHUDLayout';
export type { HUDLayoutState, UseHUDLayoutOptions } from './useHUDLayout';
export { useMultiThread } from './useMultiThread';
export type { ThreadEntry, MultiThreadState, UseMultiThreadOptions } from './useMultiThread';

// Multi-task UI
export { TaskWidgetStack } from './TaskWidgetStack';
