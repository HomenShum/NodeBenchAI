import type { ProductDraftFile } from "./productSession";

type UploadDraftFilesArgs = {
  files: File[];
  anonymousSessionId: string;
  generateUploadUrl: () => Promise<string>;
  saveFileMutation: (args: {
    anonymousSessionId: string;
    storageId: string;
    name: string;
    mimeType: string;
    size: number;
  }) => Promise<{ evidenceId?: string } | null | undefined>;
};

export async function uploadProductDraftFiles(
  args: UploadDraftFilesArgs,
): Promise<ProductDraftFile[]> {
  const uploaded: ProductDraftFile[] = [];

  for (const file of args.files) {
    const uploadUrl = await args.generateUploadUrl();
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    const { storageId } = (await uploadResponse.json()) as { storageId: string };
    const result = await args.saveFileMutation({
      anonymousSessionId: args.anonymousSessionId,
      storageId,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
    });

    uploaded.push({
      evidenceId: result?.evidenceId ? String(result.evidenceId) : undefined,
      name: file.name,
      type: file.type || "upload",
      size: file.size,
    });
  }

  return uploaded;
}
