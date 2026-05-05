/**
 * Skeleton primitives — reduced-motion safe shimmer placeholders.
 *
 *   <Skeleton.Block w={120} h={14} />
 *   <Skeleton.Card />     // a generic 3-row card placeholder
 *   <Skeleton.Row count={5} />  // a stack of placeholder rows
 */

import type { CSSProperties } from "react";

interface BlockProps {
  w?: number | string;
  h?: number | string;
  rounded?: number;
  className?: string;
  style?: CSSProperties;
}

function Block({ w = "100%", h = 12, rounded = 4, className, style }: BlockProps) {
  return (
    <span
      className={`rd-skel ${className ?? ""}`}
      style={{ width: w, height: h, borderRadius: rounded, display: "inline-block", ...style }}
      aria-hidden="true"
    />
  );
}

function Card() {
  return (
    <div className="rd-card rd-card__pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Block w={140} h={14} />
      <Block w="80%" h={10} />
      <Block w="92%" h={10} />
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <Block w={64} h={20} rounded={999} />
        <Block w={48} h={20} rounded={999} />
      </div>
    </div>
  );
}

function Row({ count = 4 }: { count?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "18px 1fr auto", gap: 10, alignItems: "center", padding: "8px 10px", border: "1px solid var(--rd-line-faint)", borderRadius: 8 }}>
          <Block w={14} h={14} rounded={999} />
          <Block w={`${50 + (i * 7) % 30}%`} h={11} />
          <Block w={48} h={9} />
        </div>
      ))}
    </div>
  );
}

export const Skeleton = { Block, Card, Row };
