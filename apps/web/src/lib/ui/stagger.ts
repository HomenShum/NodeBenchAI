/**
 * staggerDelay — produces an inline `animationDelay` style for children
 * rendered inside a `.starting-point-card` or any `fade-slide-in` container
 * so a grid/sequence lands in sequence instead of simultaneously.
 *
 * Shared between the Home Recent Reports grid and the Chat streaming
 * sections. Capped so a long list doesn't feel slow.
 */
export function staggerDelay(
  index: number,
  stepMs: number = 60,
  capMs: number = 240,
): { animationDelay: string } {
  return { animationDelay: `${Math.min(index * stepMs, capMs)}ms` };
}
