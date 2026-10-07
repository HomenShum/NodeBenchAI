/**
 * Session Manager
 * 
 * Manages active realtime voice sessions
 */

import { RealtimeSession } from '@openai/agents/realtime';

interface SessionData {
  session: RealtimeSession;
  userId: string;
  createdAt: Date;
  lastActivityAt: Date;
}

export class SessionManager {
  private sessions: Map<string, SessionData> = new Map();
  private userSessions: Map<string, Set<string>> = new Map();

  /**
   * Add a new session
   */
  addSession(userId: string, session: RealtimeSession): string {
    const sessionId = this.generateSessionId();
    
    this.sessions.set(sessionId, {
      session,
      userId,
      createdAt: new Date(),
      lastActivityAt: new Date(),
    });

    // Track user sessions
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, new Set());
    }
    this.userSessions.get(userId)!.add(sessionId);

    console.log(`[SessionManager] Added session ${sessionId} for user ${userId}`);
    return sessionId;
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): RealtimeSession | null {
    const data = this.sessions.get(sessionId);
    if (data) {
      data.lastActivityAt = new Date();
      return data.session;
    }
    return null;
  }

  /**
   * Remove a session
   */
  removeSession(sessionId: string): void {
    const data = this.sessions.get(sessionId);
    if (data) {
      // Remove from user sessions
      const userSessionSet = this.userSessions.get(data.userId);
      if (userSessionSet) {
        userSessionSet.delete(sessionId);
        if (userSessionSet.size === 0) {
          this.userSessions.delete(data.userId);
        }
      }

      this.sessions.delete(sessionId);
      console.log(`[SessionManager] Removed session ${sessionId}`);
    }
  }

  /**
   * Get all sessions for a user
   */
  getUserSessions(userId: string): RealtimeSession[] {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds) return [];

    return Array.from(sessionIds)
      .map(id => this.sessions.get(id)?.session)
      .filter((s): s is RealtimeSession => s !== undefined);
  }

  /**
   * Clean up stale sessions (older than 1 hour)
   */
  cleanupStaleSessions(): void {
    const now = new Date();
    const staleThreshold = 60 * 60 * 1000; // 1 hour

    for (const [sessionId, data] of this.sessions.entries()) {
      const age = now.getTime() - data.lastActivityAt.getTime();
      if (age > staleThreshold) {
        console.log(`[SessionManager] Cleaning up stale session ${sessionId}`);
        data.session.disconnect().catch(console.error);
        this.removeSession(sessionId);
      }
    }
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `voice_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}

// Run cleanup every 5 minutes
setInterval(() => {
  const manager = new SessionManager();
  manager.cleanupStaleSessions();
}, 5 * 60 * 1000);

