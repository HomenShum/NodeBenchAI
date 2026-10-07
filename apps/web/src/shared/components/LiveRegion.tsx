import React, { useCallback, useEffect, useState } from "react";

interface LiveRegionProps {
  message?: string;
  priority?: "polite" | "assertive";
  clearAfter?: number;
}

export function LiveRegion({
  message,
  priority = "polite",
  clearAfter = 5000,
}: LiveRegionProps) {
  const [currentMessage, setCurrentMessage] = useState(message);

  useEffect(() => {
    if (!message) return;
    setCurrentMessage(message);

    if (clearAfter <= 0) return;
    const timeoutId = setTimeout(() => {
      setCurrentMessage("");
    }, clearAfter);
    return () => clearTimeout(timeoutId);
  }, [message, clearAfter]);

  return (
    <div role="status" aria-live={priority} aria-atomic="true" className="sr-only">
      {currentMessage}
    </div>
  );
}

export function useAnnounce() {
  const [announcement, setAnnouncement] = useState<{
    message: string;
    priority: "polite" | "assertive";
    key: number;
  } | null>(null);

  const announce = useCallback(
    (message: string, priority: "polite" | "assertive" = "polite") => {
      setAnnouncement({
        message,
        priority,
        key: Date.now(),
      });
    },
    [],
  );

  const Announcer = useCallback(() => {
    if (!announcement) return null;
    return (
      <LiveRegion
        key={announcement.key}
        message={announcement.message}
        priority={announcement.priority}
      />
    );
  }, [announcement]);

  return {
    announce,
    Announcer,
  };
}

export default LiveRegion;
