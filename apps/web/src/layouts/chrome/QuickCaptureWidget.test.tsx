import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuickCaptureWidget } from "./QuickCaptureWidget";

const saveContextCaptureMock = vi.fn();
const generateUploadUrlMock = vi.fn();
const saveFileMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const stopRecordingMock = vi.fn();
const clearRecordingMock = vi.fn();
const startRecordingMock = vi.fn();
const captureScreenMock = vi.fn();
const clearScreenshotMock = vi.fn();

let voiceState = {
  isRecording: false,
  audioBlob: null as Blob | null,
  duration: 0,
};

let screenshotState = {
  screenshotData: null as string | null,
};

vi.mock("convex/react", () => ({
  useMutation: (mutation: unknown) => {
    if (mutation === "product.me.saveContextCapture") return saveContextCaptureMock;
    if (mutation === "product.me.generateUploadUrl") return generateUploadUrlMock;
    if (mutation === "product.me.saveFile") return saveFileMock;
    return vi.fn();
  },
}));

vi.mock("@/lib/convexApi", () => ({
  useConvexApi: () => ({
    domains: {
      product: {
        me: {
          saveContextCapture: "product.me.saveContextCapture",
          generateUploadUrl: "product.me.generateUploadUrl",
          saveFile: "product.me.saveFile",
        },
      },
    },
  }),
}));

vi.mock("@/lib/motion", () => ({
  useMotionConfig: () => ({
    instant: true,
    transition: () => ({}),
  }),
}));

vi.mock("@/features/product/lib/productIdentity", () => ({
  getAnonymousProductSessionId: () => "anon_test",
}));

vi.mock("@/hooks/useVoiceRecording", () => ({
  useVoiceRecording: () => ({
    ...voiceState,
    startRecording: startRecordingMock,
    stopRecording: stopRecordingMock,
    clearRecording: clearRecordingMock,
  }),
}));

vi.mock("@/hooks/useScreenCapture", () => ({
  useScreenCapture: () => ({
    ...screenshotState,
    captureScreen: captureScreenMock,
    clearScreenshot: clearScreenshotMock,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      animate,
      exit,
      initial,
      transition,
      whileHover,
      whileTap,
      ...props
    }: HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => <div {...props}>{children}</div>,
    button: ({
      children,
      animate,
      exit,
      initial,
      transition,
      whileHover,
      whileTap,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & Record<string, unknown>) => <button {...props}>{children}</button>,
  },
}));

describe("QuickCaptureWidget", () => {
  beforeEach(() => {
    saveContextCaptureMock.mockReset();
    generateUploadUrlMock.mockReset();
    saveFileMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    stopRecordingMock.mockReset();
    clearRecordingMock.mockReset();
    startRecordingMock.mockReset();
    captureScreenMock.mockReset();
    clearScreenshotMock.mockReset();

    voiceState = {
      isRecording: false,
      audioBlob: null,
      duration: 0,
    };
    screenshotState = {
      screenshotData: null,
    };

    saveContextCaptureMock.mockResolvedValue({ contextItemId: "ctx_1" });
    generateUploadUrlMock.mockResolvedValue("https://example.com/upload");
    saveFileMock.mockResolvedValue({ evidenceId: "file_1" });
  });

  it("saves note captures through the canonical product mutation", async () => {
    render(<QuickCaptureWidget />);

    fireEvent.click(screen.getByRole("button", { name: /open quick capture/i }));
    fireEvent.change(screen.getByPlaceholderText(/capture a thought/i), {
      target: { value: "Remember this customer quote" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(saveContextCaptureMock).toHaveBeenCalledWith({
        anonymousSessionId: "anon_test",
        type: "note",
        content: "Remember this customer quote",
      }),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Captured!");
    expect(saveFileMock).not.toHaveBeenCalled();
  });

  it("stops and clears voice state when leaving voice mode", async () => {
    voiceState = {
      isRecording: true,
      audioBlob: null,
      duration: 12,
    };

    render(<QuickCaptureWidget />);

    fireEvent.click(screen.getByRole("button", { name: /open quick capture/i }));
    fireEvent.click(screen.getByRole("button", { name: /voice/i }));
    fireEvent.click(screen.getByRole("button", { name: /note/i }));

    await waitFor(() => expect(stopRecordingMock).toHaveBeenCalledTimes(1));
    expect(clearRecordingMock).toHaveBeenCalled();
    expect(clearScreenshotMock).toHaveBeenCalled();
  });
});
