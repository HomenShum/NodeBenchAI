import type { ReactNode } from "react";

type Tone = "default" | "accent" | "green" | "blue" | "amber" | "red";

const CLASS_MAP: Record<Tone, string> = {
  default: "rd-pill",
  accent: "rd-pill rd-pill--accent",
  green: "rd-pill rd-pill--green",
  blue: "rd-pill rd-pill--blue",
  amber: "rd-pill rd-pill--amber",
  red: "rd-pill rd-pill--red",
};

export function Pill({ tone = "default", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={CLASS_MAP[tone]}>{children}</span>;
}
