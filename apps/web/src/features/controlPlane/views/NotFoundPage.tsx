import { useNavigate } from "react-router-dom";

/**
 * NotFoundPage — 404 catch-all for unrecognized routes.
 *
 * Glass card DNA, centered layout, warm accent.
 */
export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div
        className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-white/[0.04] p-10 text-center backdrop-blur-xl"
        role="alert"
      >
        {/* Logo mark */}
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-[#d97757]">
          <span className="text-2xl font-bold text-white" aria-hidden="true">
            N
          </span>
        </div>

        <p className="mb-2 text-5xl font-bold tabular-nums text-content">404</p>
        <h1 className="mb-3 text-lg font-semibold text-content">
          Page not found
        </h1>
        <p className="mb-8 text-sm leading-relaxed text-content-muted">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>

        <button
          type="button"
          onClick={() => navigate("/")}
          className="inline-flex items-center gap-2 rounded-lg bg-[#d97757] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#c4664a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
        >
          Go to NodeBench
        </button>
      </div>
    </div>
  );
}
