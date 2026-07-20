import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";

export type SourceMatrixItem = {
  title: string;
  url: string;
  domain?: string;
  snippet?: string;
};

export type ReaderContentResponse = {
  ok: boolean;
  cached: boolean;
  url: string;
  content: string;
  excerpt: string;
  contentBytes: number;
  isTruncated: boolean;
  sourceMatrix: SourceMatrixItem[];
  analyzedAt?: number;
};

type ReaderContentState =
  | { status: "idle"; data: null; error: null }
  | { status: "loading"; data: ReaderContentResponse | null; error: null }
  | { status: "ready"; data: ReaderContentResponse; error: null }
  | { status: "error"; data: ReaderContentResponse | null; error: string };

export function useReaderContent(url?: string, title?: string) {
  const fetchReaderContent = useAction(
    (api as any).domains.research.readerContent.getReaderContent,
  );
  const [state, setState] = useState<ReaderContentState>({
    status: url ? "loading" : "idle",
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!url) {
      setState({ status: "idle", data: null, error: null });
      return;
    }

    let active = true;
    setState((prev) => ({ status: "loading", data: prev.data ?? null, error: null }));

    fetchReaderContent({ url, title })
      .then((res: ReaderContentResponse) => {
        if (!active) return;
        setState({ status: "ready", data: res, error: null });
      })
      .catch((err: any) => {
        if (!active) return;
        setState({
          status: "error",
          data: null,
          error: err?.message || "Failed to load reader content.",
        });
      });

    return () => {
      active = false;
    };
  }, [url, title, fetchReaderContent]);

  return state;
}

export default useReaderContent;
