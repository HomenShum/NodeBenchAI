import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Globe } from "lucide-react";
import { DocumentCard } from "@features/documents/components/documentsHub";
import { PageHeroHeader } from "@shared/ui/PageHeroHeader";
import { sanitizeDocumentTitle, sanitizeReadableText } from "@/lib/displayText";


interface PublicDocumentsProps {
  onDocumentSelect: (documentId: Id<"documents">) => void;
}

export function PublicDocuments({ onDocumentSelect }: PublicDocumentsProps) {
  const publicDocuments = useQuery(api.domains.documents.documents.getPublic);

  const buildPreviewText = (doc: Record<string, unknown>): string | null => {
    const candidates = [
      doc.contentPreview,
      doc.preview,
      doc.summary,
      doc.description,
      doc.excerpt,
      doc.snippet,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return sanitizeReadableText(candidate).trim();
      }
    }
    return null;
  };

  if (publicDocuments === undefined) {
    return (
      <div className="nb-page-shell">
        <div className="nb-page-inner">
          <div className="nb-page-frame-narrow flex items-center justify-center min-h-[40vh]">
            <div className="motion-safe:animate-spin rounded-full h-8 w-8 border-b-2 border-content"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="nb-page-shell">
      <div className="nb-page-inner">
        <div className="nb-page-frame-narrow">
        <div className="mb-8">
          <PageHeroHeader
            icon={<Globe className="h-6 w-6 text-green-600" />}
            title={"Public Documents"}
            subtitle={"Discover documents shared by the community"}
          />
        </div>

        {publicDocuments.length === 0 ? (
          <div className="text-center py-12">
            <Globe className="h-12 w-12 text-content-muted mx-auto mb-4" />
            <h3 className="text-lg font-medium text-content mb-2">
              No public documents yet
            </h3>
            <p className="text-content-secondary">
              Be the first to share a document with the community!
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {publicDocuments.map((doc) => {
              const cardDoc = {
                _id: doc._id as Id<"documents">,
                title: sanitizeDocumentTitle(doc.title),
                documentType: (doc as any).documentType,
                fileType: (doc as any).fileType,
                fileId: (doc as any).fileId,
                lastModified: (doc as any).lastModified || doc._creationTime,
                createdBy: doc.createdBy as Id<"users">,
                isArchived: doc.isArchived,
                isFavorite: (doc as any).isFavorite,
                coverImage: (doc as any).coverImage,
                icon: (doc as any).icon,
                contentPreview: buildPreviewText(doc as Record<string, unknown>),
              };

              return (
                <DocumentCard
                  key={doc._id}
                  doc={cardDoc}
                  onSelect={onDocumentSelect}
                  hybrid={true}
                  openOnSingleClick={true}
                />
              );
            })}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
