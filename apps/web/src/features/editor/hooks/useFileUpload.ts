/**
 * File upload hook for UnifiedEditor
 * Handles file uploads to Convex storage
 */

import { useCallback } from 'react';
import { useMutation, useConvex } from 'convex/react';
import { api } from '../../../../convex/_generated/api';

export function useFileUpload() {
  const convex = useConvex();
  const generateUploadUrl = useMutation(api.domains.documents.files.generateUploadUrl);
  const createFileRecord = useMutation(api.domains.documents.files.createFile);

  const uploadFile = useCallback(async (file: File): Promise<string> => {
    try {

      // Generate upload URL from Convex
      const uploadUrl = await generateUploadUrl();

      // Upload file to Convex storage
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      const { storageId } = await response.json() as { storageId: string };

      // Create file record in database
      await createFileRecord({
        storageId,
        fileName: file.name,
        fileType: file.type.startsWith('image/') ? 'image' : 'document',
        mimeType: file.type,
        fileSize: file.size,
      });

      // Get the public URL for the uploaded file
      const fileUrl = await convex.query(api.domains.documents.files.getUrl, { storageId });

      return fileUrl || '';
    } catch (error) {
      console.error('[useFileUpload] File upload error:', error);
      throw error;
    }
  }, [generateUploadUrl, createFileRecord, convex]);

  return { uploadFile };
}

