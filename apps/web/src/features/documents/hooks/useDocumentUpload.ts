/**
 * useDocumentUpload
 *
 * File upload, drag-drop, and import controller.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useAction } from "convex/react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Helpers (MIME type from file extension)
// ---------------------------------------------------------------------------

function ensureMimeType(file: File): string {
  if (file.type && file.type !== "application/octet-stream") return file.type;

  const ext = file.name.toLowerCase().split(".").pop() || "";

  const byExt: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv",
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    aac: "audio/aac",
    ogg: "audio/ogg",
  };

  return byExt[ext] || "application/octet-stream";
}

function getFileType(file: File): string {
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (file.name.toLowerCase().endsWith(".csv")) return "csv";
  if (file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  return "file";
}

function getAnalysisType(file: File): string {
  const t = getFileType(file);
  if (t === "video") return "highlights";
  if (t === "image") return "object-detection";
  if (file.name.toLowerCase().endsWith(".csv")) return "csv";
  return "general";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseDocumentUploadParams {
  /** Called when user selects/opens a document */
  onDocumentSelect: (documentId: Id<"documents">) => void;
}

export interface DocumentUploadSlice {
  isUploading: boolean;
  uploadProgress: string;
  isFileDragActive: boolean;
  fileDragCounterRef: React.MutableRefObject<number>;
  lastWindowDropAtRef: React.MutableRefObject<number>;
  handleFileUpload: (file: File) => Promise<void>;
  onDrop: (acceptedFiles: File[]) => void;
  getRootProps: ReturnType<typeof useDropzone>["getRootProps"];
  getInputProps: ReturnType<typeof useDropzone>["getInputProps"];
  open: ReturnType<typeof useDropzone>["open"];
  isDragActive: boolean;

  // --- Mutations (pass-through) ---
  generateUploadUrl: ReturnType<typeof useMutation>;
  createFileRecord: ReturnType<typeof useMutation>;
  createDocumentWithContent: ReturnType<typeof useMutation>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDocumentUpload({
  onDocumentSelect,
}: UseDocumentUploadParams): DocumentUploadSlice {
  // -------------------------------------------------------------------------
  // Mutations & actions
  // -------------------------------------------------------------------------

  const generateUploadUrl = useMutation(api.domains.documents.files.generateUploadUrl);
  const createFileRecord = useMutation(api.domains.documents.files.createFile);
  const createDocumentWithContent = useMutation(
    api.domains.documents.documents.createWithContent,
  );
  const createDocument = useMutation(api.domains.documents.documents.create);
  const analyzeFileWithGenAI = useAction(api.domains.documents.fileAnalysis.analyzeFileWithGenAI);
  const extractAndIndexFile = useAction(api.domains.ai.genai.extractAndIndexFile);

  // -------------------------------------------------------------------------
  // Upload state
  // -------------------------------------------------------------------------

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");
  const lastWindowDropAtRef = useRef<number>(0);

  // -------------------------------------------------------------------------
  // File upload handler
  // -------------------------------------------------------------------------

  const handleFileUpload = useCallback(
    async (file: File) => {
      setIsUploading(true);

      try {
        setUploadProgress(`Uploading 1/1: ${file.name}`);

        const uploadUrl = await generateUploadUrl();
        const mime = ensureMimeType(file);

        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": mime },
          body: file,
        });

        if (!res.ok) throw new Error(`Upload failed: ${res.status}`);

        const { storageId } = (await res.json()) as { storageId: string };

        const fileId = await createFileRecord({
          storageId,
          fileName: file.name,
          fileType: getFileType(file),
          mimeType: mime,
          fileSize: file.size,
        });

        // Auto-extract chunks + embeddings (creates meta.page for PDFs)
        extractAndIndexFile({ fileId, force: true })
          .then((indexRes) => {
            if (indexRes.inserted > 0) {
              toast.success(`Indexed ${indexRes.inserted} chunks for ${file.name}`);
            }
          })
          .catch(() => {});

        toast.success(`Uploaded ${file.name}`, {
          action: {
            label: "Analyze now",
            onClick: async () => {
              try {
                setUploadProgress(`Analyzing ${file.name}...`);

                const result = await analyzeFileWithGenAI({
                  fileId,
                  analysisPrompt:
                    "Provide a comprehensive analysis of this file, including key insights and summary.",
                  analysisType: getAnalysisType(file),
                });

                if ((result as any)?.success) {
                  toast.success(`Analysis complete for ${file.name}`);

                  const docId = await createDocument({
                    title: `Analysis: ${file.name}`,
                    content: [
                      {
                        type: "paragraph",
                        content: [
                          { type: "text", text: (result as any).analysis },
                        ],
                      },
                    ],
                  });

                  onDocumentSelect(docId);
                } else {
                  toast.error(`Analysis failed for ${file.name}`);
                }
              } catch (err: any) {
                console.error(err);
                toast.error(err?.message || `Analysis failed for ${file.name}`);
              } finally {
                setUploadProgress("");
              }
            },
          },
        });
      } catch (e: any) {
        console.error(e);
        toast.error(e?.message || `Failed to upload ${file.name}`);
      } finally {
        setIsUploading(false);
        setUploadProgress("");
      }
    },
    [
      generateUploadUrl,
      createFileRecord,
      analyzeFileWithGenAI,
      extractAndIndexFile,
      createDocument,
      onDocumentSelect,
    ],
  );

  // -------------------------------------------------------------------------
  // onDrop
  // -------------------------------------------------------------------------

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      // If a window-level drop just fired, ignore the dropzone drop
      if (Date.now() - lastWindowDropAtRef.current < 250) {
        return;
      }
      if (!acceptedFiles?.length) return;

      void (async () => {
        for (const f of acceptedFiles) {
          await handleFileUpload(f);
        }
      })();
    },
    [handleFileUpload],
  );

  // -------------------------------------------------------------------------
  // Global file drag tracking
  // -------------------------------------------------------------------------

  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const fileDragCounterRef = useRef(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      !!e.dataTransfer &&
      Array.from(e.dataTransfer.types || []).includes("Files");

    const isLeavingWindow = (e: DragEvent) => {
      const x = (e as any).clientX ?? 0;
      const y = (e as any).clientY ?? 0;
      return (
        (e.relatedTarget === null || (e as any).fromElement === null) &&
        (x <= 0 || y <= 0 || x >= window.innerWidth || y >= window.innerHeight)
      );
    };

    const onEnter = (e: DragEvent) => {
      if (hasFiles(e)) {
        setIsFileDragActive(true);
      }
    };

    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) {
        e.preventDefault();
      }
    };

    const onLeave = (e: DragEvent) => {
      if (hasFiles(e) && isLeavingWindow(e)) {
        setIsFileDragActive(false);
      }
    };

    const onDropWin = (e: DragEvent) => {
      if (
        e &&
        e.dataTransfer &&
        e.dataTransfer.files &&
        e.dataTransfer.files.length > 0
      ) {
        e.preventDefault();
      }
      fileDragCounterRef.current = 0;
      setIsFileDragActive(false);
    };

    const handleDragEnter = (e: Event) => onEnter(e as DragEvent);
    const handleDragOver = (e: Event) => onOver(e as DragEvent);
    const handleDragLeave = (e: Event) => onLeave(e as DragEvent);
    const handleDrop = (e: Event) => onDropWin(e as DragEvent);

    window.addEventListener("dragenter", handleDragEnter, { capture: true } as any);
    window.addEventListener("dragover", handleDragOver, { capture: true } as any);
    window.addEventListener("dragleave", handleDragLeave, { capture: true } as any);
    window.addEventListener("drop", handleDrop, { capture: true } as any);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter, { capture: true } as any);
      window.removeEventListener("dragover", handleDragOver, { capture: true } as any);
      window.removeEventListener("dragleave", handleDragLeave, { capture: true } as any);
      window.removeEventListener("drop", handleDrop, { capture: true } as any);
    };
  }, [onDrop]);

  // -------------------------------------------------------------------------
  // react-dropzone
  // -------------------------------------------------------------------------

  const { getRootProps, getInputProps, open, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    multiple: true,
  });

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    isUploading,
    uploadProgress,
    isFileDragActive,
    fileDragCounterRef,
    lastWindowDropAtRef,
    handleFileUpload,
    onDrop,
    getRootProps,
    getInputProps,
    open,
    isDragActive,
    generateUploadUrl,
    createFileRecord,
    createDocumentWithContent,
  };
}
