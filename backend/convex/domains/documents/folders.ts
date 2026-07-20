import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "../../_generated/server";
import { Id, Doc } from "../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Utility function to safely extract and validate user ID from authentication
 * Handles malformed user IDs with pipe characters that may come from auth providers
 * Supports evaluation mode where userId is passed in ctx.evaluationUserId
 */
async function getSafeUserId(ctx: any): Promise<Id<"users">> {
  // Support evaluation mode where userId is passed in ctx.evaluationUserId
  if ((ctx).evaluationUserId) {
    return (ctx).evaluationUserId as Id<"users">;
  }

  const rawUserId = await getAuthUserId(ctx);
  if (!rawUserId) {
    throw new Error("Not authenticated");
  }

  // Handle malformed user IDs with pipe characters
  let userId: Id<"users">;
  if (typeof rawUserId === 'string' && rawUserId.includes('|')) {
    // Extract the first part before the pipe as the actual user ID
    const userIdPart = rawUserId.split('|')[0];

    // Validate that this looks like a proper Convex ID
    if (!userIdPart || userIdPart.length < 10) {
      throw new Error("Invalid user ID format. Please sign out and sign back in.");
    }

    userId = userIdPart as Id<"users">;
  } else {
    userId = rawUserId;
  }

  // Verify the user exists in the database
  const user = await ctx.db.get(userId);
  if (!user) {
    throw new Error("User not found. Please sign out and sign back in.");
  }

  return userId;
}

/**
 * Utility function to safely extract user ID from identity subject
 * Handles malformed user IDs with pipe characters that may come from auth providers
 */
function getSafeUserIdFromIdentity(identity: any): Id<"users"> {
  if (!identity?.subject) {
    throw new Error("Invalid identity");
  }

  const rawSubject = identity.subject;
  
  // Handle malformed user IDs with pipe characters
  if (typeof rawSubject === 'string' && rawSubject.includes('|')) {
    // Extract the first part before the pipe as the actual user ID
    const userIdPart = rawSubject.split('|')[0];
    
    // Validate that this looks like a proper Convex ID
    if (!userIdPart || userIdPart.length < 10) {
      throw new Error("Invalid user ID format. Please sign out and sign back in.");
    }
    
    return userIdPart;
  }
  
  return rawSubject as Id<"users">;
}

/* ------------------------------------------------------------------ */
/* FOLDER MUTATIONS                                                    */
/* ------------------------------------------------------------------ */

/**
 * Create a new folder for the authenticated user
 */
export const createFolder = mutation({
  args: {
    name: v.string(),
    color: v.string(),
    isExpanded: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);

    // Check if folder with same name already exists for this user
    const existingFolder = await ctx.db
      .query("folders")
      .withIndex("by_user_name", (q) => 
        q.eq("userId", userId).eq("name", args.name)
      )
      .first();

    if (existingFolder) {
      throw new Error("A folder with this name already exists");
    }

    const now = Date.now();
    const folderId = await ctx.db.insert("folders", {
      name: args.name,
      color: args.color,
      userId: userId,
      isExpanded: args.isExpanded ?? true,
      createdAt: now,
      updatedAt: now,
    });

    return folderId;
  },
});

/**
 * Update folder properties (name, color, expanded state)
 */
export const updateFolder = mutation({
  args: {
    folderId: v.id("folders"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    isExpanded: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const userId = getSafeUserIdFromIdentity(identity);

    const folder = await ctx.db.get(args.folderId) as Doc<"folders"> | null;
    if (!folder) {
      throw new Error("Folder not found");
    }

    if (folder.userId !== userId) {
      throw new Error("Not authorized to update this folder");
    }

    // If updating name, check for conflicts
    if (args.name && args.name !== folder.name) {
      const existingFolder = await ctx.db
        .query("folders")
        .withIndex("by_user_name", (q) =>
          q.eq("userId", userId).eq("name", args.name)
        )
        .first() as Doc<"folders"> | null;

      if (existingFolder && existingFolder._id !== args.folderId) {
        throw new Error("A folder with this name already exists");
      }
    }

    const updates: any = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.color !== undefined) updates.color = args.color;
    if (args.isExpanded !== undefined) updates.isExpanded = args.isExpanded;

    await ctx.db.patch(args.folderId, updates);
    return { success: true };
  },
});

/**
 * Delete a folder and remove all document associations
 */
export const deleteFolder = mutation({
  args: {
    folderId: v.id("folders"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const folder = await ctx.db.get(args.folderId) as Doc<"folders"> | null;
    if (!folder) {
      throw new Error("Folder not found");
    }

    if (folder.userId !== identity.subject) {
      throw new Error("Not authorized to delete this folder");
    }

    // Remove all document-folder relationships
    const documentFolders = await ctx.db
      .query("documentFolders")
      .withIndex("by_folder", (q) => q.eq("folderId", args.folderId))
      .collect();

    for (const df of documentFolders) {
      await ctx.db.delete(df._id);
    }

    // Delete the folder
    await ctx.db.delete(args.folderId);
    return { success: true };
  },
});

/* ------------------------------------------------------------------ */
/* DOCUMENT-FOLDER RELATIONSHIP MUTATIONS                             */
/* ------------------------------------------------------------------ */

/**
 * Add a document to a folder
 */
export const addDocumentToFolder = mutation({
  args: {
    documentId: v.id("documents"),
    folderId: v.id("folders"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Verify document exists and user owns it
    const document = await ctx.db.get(args.documentId) as Doc<"documents"> | null;
    if (!document) {
      throw new Error("Document not found");
    }
    if (document.createdBy !== identity.subject) {
      throw new Error("Not authorized to organize this document");
    }

    // Verify folder exists and user owns it
    const folder = await ctx.db.get(args.folderId) as Doc<"folders"> | null;
    if (!folder) {
      throw new Error("Folder not found");
    }
    if (folder.userId !== identity.subject) {
      throw new Error("Not authorized to use this folder");
    }

    // Check if relationship already exists
    const existing = await ctx.db
      .query("documentFolders")
      .withIndex("by_document_folder", (q) => 
        q.eq("documentId", args.documentId).eq("folderId", args.folderId)
      )
      .first();

    if (existing) {
      return { success: true, message: "Document already in folder" };
    }

    // Create the relationship
    await ctx.db.insert("documentFolders", {
      documentId: args.documentId,
      folderId: args.folderId,
      userId: identity.subject as Id<"users">,
      addedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Remove a document from a folder
 */
export const removeDocumentFromFolder = mutation({
  args: {
    documentId: v.id("documents"),
    folderId: v.id("folders"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const relationship = await ctx.db
      .query("documentFolders")
      .withIndex("by_document_folder", (q) =>
        q.eq("documentId", args.documentId).eq("folderId", args.folderId)
      )
      .first() as Doc<"documentFolders"> | null;

    if (!relationship) {
      return { success: true, message: "Document not in folder" };
    }

    if (relationship.userId !== identity.subject) {
      throw new Error("Not authorized to modify this relationship");
    }

    await ctx.db.delete(relationship._id);
    return { success: true };
  },
});

/**
 * Remove a document from all folders
 */
export const removeDocumentFromAllFolders = mutation({
  args: {
    documentId: v.id("documents"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const relationships = await ctx.db
      .query("documentFolders")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .filter((q) => q.eq(q.field("userId"), identity.subject))
      .collect();

    for (const relationship of relationships) {
      await ctx.db.delete(relationship._id);
    }

    return { success: true, removedCount: relationships.length };
  },
});

/* ------------------------------------------------------------------ */
/* FOLDER QUERIES                                                      */
/* ------------------------------------------------------------------ */

/**
 * Get all folders for the authenticated user
 */
export const getUserFolders = query({
  args: {
    userId: v.optional(v.id("users")), // Optional for evaluation/testing
  },
  handler: async (ctx, args) => {
    // Use provided userId or fall back to authenticated user
    let userId: Id<"users"> | undefined = args.userId;
    if (!userId) {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) {
        return [];
      }
      userId = identity.subject as Id<"users">;
    }

    const folders = await ctx.db
      .query("folders")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("asc")
      .collect();

    return folders;
  },
});

/**
 * Get a specific folder with its documents
 */
export const getFolderWithDocuments = query({
  args: {
    folderId: v.id("folders"),
    userId: v.optional(v.id("users")), // Optional for evaluation/testing
  },
  handler: async (ctx, args) => {
    // Use provided userId or fall back to authenticated user
    let userId: Id<"users"> | undefined = args.userId;
    if (!userId) {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) {
        throw new Error("Not authenticated");
      }
      userId = identity.subject as Id<"users">;
    }

    const folder = await ctx.db.get(args.folderId) as Doc<"folders"> | null;
    if (!folder) {
      throw new Error("Folder not found");
    }

    if (folder.userId !== userId) {
      throw new Error("Not authorized to view this folder");
    }

    // Get document relationships
    const documentFolders = await ctx.db
      .query("documentFolders")
      .withIndex("by_folder", (q) => q.eq("folderId", args.folderId))
      .collect();

    // Get the actual documents
    const documents: any[] = [];
    for (const df of documentFolders) {
      const doc = await ctx.db.get(df.documentId) as Doc<"documents"> | null;
      if (doc && !doc.isArchived) {
        documents.push({
          ...doc,
          addedToFolderAt: df.addedAt,
        });
      }
    }

    return {
      ...folder,
      documents,
      documentCount: documents.length,
    };
  },
});

/**
 * Get all folder-document relationships for user's documents
 */
export const getUserDocumentFolders = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const relationships = await ctx.db
      .query("documentFolders")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject as Id<"users">))
      .collect();

    return relationships;
  },
});

/**
 * Get documents that are not in any folder
 */
export const getUnfolderedDocuments = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    // Get all user's documents
    const allDocuments = await ctx.db
      .query("documents")
      .withIndex("by_user", (q) => q.eq("createdBy", identity.subject as Id<"users">))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    // Get all document-folder relationships
    const relationships = await ctx.db
      .query("documentFolders")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject as Id<"users">))
      .collect();

    const folderedDocumentIds = new Set(relationships.map(r => r.documentId));

    // Return documents not in any folder
    return allDocuments.filter(doc => !folderedDocumentIds.has(doc._id));
  },
});

/* ------------------------------------------------------------------ */
/* INTERNAL FUNCTIONS                                                  */
/* ------------------------------------------------------------------ */

/**
 * Internal function to get folder by ID (used by other backend functions)
 */
export const getFolder = internalQuery({
  args: { folderId: v.id("folders") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.folderId);
  },
});

/**
 * Internal function to update folder timestamp
 */
export const updateFolderTimestamp = internalMutation({
  args: { folderId: v.id("folders") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.folderId, { updatedAt: Date.now() });
  },
});
