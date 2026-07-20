import React from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { FileSpreadsheet } from "lucide-react";

export function SpreadsheetsHub({
  onOpenSheet,
}: {
  onOpenSheet: (id: Id<"spreadsheets">) => void;
}) {
  const sheets = useQuery(api.domains.integrations.spreadsheets.listSheets, { limit: 50 });

  return (
    <div className="h-full overflow-auto bg-background p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">Spreadsheets</h2>
        </div>

        {!sheets ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg border border-border/60 bg-card p-4">
                <div className="h-4 bg-muted/40 rounded w-3/4 mb-2" />
                <div className="h-3 bg-muted/30 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : sheets.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-indigo-500/10 rounded-lg flex items-center justify-center mx-auto mb-4">
              <FileSpreadsheet className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Create your first spreadsheet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
              Create your first spreadsheet to start organizing and analyzing data.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sheets.map((s: any) => (
              <button
                key={String(s._id)}
                type="button"
                className="text-left rounded-lg border border-border/60 bg-card hover:bg-muted/20 p-4 shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                onClick={() => onOpenSheet(s._id as Id<"spreadsheets">)}
              >
                <div className="text-sm font-medium text-foreground truncate">
                  {s.name || "Untitled spreadsheet"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Updated {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "-"}
                </div>
                {s.dcfSessionId && (
                  <div className="text-xs text-muted-foreground mt-2">
                    Linked DCF model
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
