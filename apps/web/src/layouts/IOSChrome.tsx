/**
 * IOSChrome — fixed faux iOS status bar (time + signal + battery) and
 * home indicator, rendered only on mobile viewport. Makes the web app
 * visually read as a native iOS experience in screen recordings + on
 * phones without a browser chrome crop.
 *
 * References:
 *   - Apple HIG: https://developer.apple.com/design/human-interface-guidelines/app-icons
 *   - Dynamic Island / status-bar spec (44pt including safe area)
 *   - Home indicator (134px wide × 5px tall, ~8px from bottom)
 */

import { memo, useEffect, useState } from "react";

function formatTime(date: Date): string {
  const h = date.getHours() % 12 || 12;
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

export const IOSChrome = memo(function IOSChrome() {
  const [time, setTime] = useState<string>(() => formatTime(new Date()));

  useEffect(() => {
    const tick = () => setTime(formatTime(new Date()));
    tick();
    const id = window.setInterval(tick, 20_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <>
      {/* Status bar — mobile only, top. 44pt tall including safe area. */}
      <div
        className="fixed inset-x-0 top-0 z-[100] flex items-end justify-between px-6 pb-1 sm:hidden"
        style={{
          height: "calc(env(safe-area-inset-top, 0px) + 22px)",
          paddingTop: "env(safe-area-inset-top, 0px)",
          background: "rgba(12,15,20,0.98)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
        aria-hidden="true"
      >
        <span className="nb-text-meta text-white">{time}</span>
        <span className="flex items-center gap-1 text-white">
          {/* Signal bars */}
          <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor" aria-hidden="true">
            <rect x="0" y="7" width="3" height="4" rx="0.5" />
            <rect x="4.5" y="5" width="3" height="6" rx="0.5" />
            <rect x="9" y="3" width="3" height="8" rx="0.5" />
            <rect x="13.5" y="1" width="3" height="10" rx="0.5" opacity="0.45" />
          </svg>
          {/* Wi-Fi */}
          <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor" aria-hidden="true">
            <path d="M8 11a1.25 1.25 0 100-2.5A1.25 1.25 0 008 11zm0-3.3a2.5 2.5 0 011.77.73l.88-.88a3.75 3.75 0 00-5.3 0l.88.88A2.5 2.5 0 018 7.7zm0-3a5 5 0 013.54 1.46l.88-.88a6.25 6.25 0 00-8.84 0l.88.88A5 5 0 018 4.7zm0-3a7.5 7.5 0 015.3 2.2l.88-.88A8.75 8.75 0 001.82 2.02l.88.88A7.5 7.5 0 018 1.7z" />
          </svg>
          {/* Battery */}
          <svg width="25" height="11" viewBox="0 0 25 11" fill="none" aria-hidden="true">
            <rect x="0.5" y="0.5" width="21" height="10" rx="2.5" stroke="currentColor" strokeOpacity="0.45" />
            <rect x="2" y="2" width="18" height="7" rx="1.25" fill="currentColor" />
            <rect x="22.5" y="3.5" width="1.5" height="4" rx="0.5" fill="currentColor" opacity="0.45" />
          </svg>
        </span>
      </div>

      {/* Home indicator — mobile only, bottom. 134×5px pill above safe area. */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex justify-center pb-1.5 sm:hidden"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6px)" }}
        aria-hidden="true"
      >
        <span className="h-[5px] w-[134px] rounded-full bg-black/35 dark:bg-white/[0.28]" />
      </div>
    </>
  );
});

export default IOSChrome;
