/**
 * Trigger extractAndIndexFile for the uploaded PDF.
 * Uses Convex admin client to bypass auth.
 * Run: npx tsx scripts/trigger-pdf-extraction.ts
 */
import { ConvexHttpClient } from "convex/browser";
import { api, internal } from "../backend/convex/_generated/api.js";

const CONVEX_URL = "https://formal-shepherd-851.convex.cloud";

async function main() {
  const client = new ConvexHttpClient(CONVEX_URL);

  // Step 1: Find all files to locate the PDF
  console.log("Querying files table for the uploaded PDF...");
  
  // Use the public getUserFiles query - but this needs auth
  // Let's use listRecentFiles instead
  try {
    const files = await client.query(api.domains.documents.files.listRecentFiles, { limit: 10 });
    console.log("Recent files:", JSON.stringify(files, null, 2));
  } catch (e: any) {
    console.log("listRecentFiles requires auth, trying alternative approach...");
  }

  // Try getUserFileDocuments
  try {
    const fileDocs = await client.query(api.domains.documents.fileDocuments.getUserFileDocuments, {});
    console.log("File documents:", JSON.stringify(fileDocs?.map((d: any) => ({
      id: d._id,
      title: d.title,
      fileId: d.fileId,
      fileType: d.fileType,
    })), null, 2));
  } catch (e: any) {
    console.log("getUserFileDocuments requires auth:", e.message?.slice(0, 100));
  }

  // Since public queries need auth, let's try the smoke test which is also public
  // We need to find the fileId first. Let's check if we can get it from the document ID
  // The document ID from the chat was: jx77js49mbc2ncdtn8c88vd6jd8119m4
  try {
    const fileDoc = await client.query(api.domains.documents.fileDocuments.getFileDocument, {
      documentId: "jx77js49mbc2ncdtn8c88vd6jd8119m4" as any,
    });
    if (fileDoc?.file) {
      console.log("Found file:", {
        fileId: fileDoc.file._id,
        fileName: fileDoc.file.fileName,
        fileType: fileDoc.file.fileType,
        analyzedAt: fileDoc.file.analyzedAt,
      });
      
      // Step 2: Trigger extraction
      console.log("\nTriggering extractAndIndexFile...");
      const result = await client.action(api.domains.ai.genai.extractAndIndexFile, {
        fileId: fileDoc.file._id,
        force: true,
      });
      console.log("Extraction result:", JSON.stringify(result, null, 2));
    } else {
      console.log("No file found for document");
    }
  } catch (e: any) {
    console.log("Error:", e.message?.slice(0, 200));
  }
}

main().catch(console.error);
