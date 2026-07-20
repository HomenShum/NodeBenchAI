import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import Spreadsheet from "react-spreadsheet";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useFastAgent } from "@/features/agents/context/FastAgentContext";

type Cell = { value: string; readOnly?: boolean };

const MultiLineDataEditor: React.FC<any> = ({ cell, onChange, exitEditMode }) => {
  const ref = React.useRef<HTMLTextAreaElement | null>(null);
  const [val, setVal] = React.useState<string>(String(cell?.value ?? ""));
  React.useEffect(() => {
    setVal(String(cell?.value ?? ""));
  }, [cell]);
  React.useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <textarea
      ref={ref}
      rows={2}
      style={{
        resize: "none",
        width: "100%",
        fontSize: "12px",
        lineHeight: "1.2",
        padding: "6px 8px",
        border: "none",
        outline: "none",
        background: "transparent",
      }}
      value={val}
      onChange={(e) => {
        const v = e.target.value;
        setVal(v);
        onChange({ ...cell, value: v });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          exitEditMode();
        }
      }}
      onBlur={exitEditMode}
    />
  );
};

function isEditableDCFCell(row: number, col: number): boolean {
  if (col !== 1) return false;
  if (row >= 6 && row <= 10) return true; // revenueGrowthRates[0..4]
  if (row === 11) return true; // terminalGrowth
  if (row === 14) return true; // riskFreeRate
  if (row === 15) return true; // beta
  if (row === 16) return true; // marketRiskPremium
  return false;
}

export function SpreadsheetSheetView({
  sheetId,
  onBack,
}: {
  sheetId: Id<"spreadsheets">;
  onBack: () => void;
}) {
  const { openWithContext } = useFastAgent();
  const sheet = useQuery(api.domains.integrations.spreadsheets.getSheet, { sheetId });
  const cells = useQuery(api.domains.integrations.spreadsheets.getRange, {
    sheetId,
    startRow: 0,
    endRow: 50,
    startCol: 0,
    endCol: 10,
  });

  const applyOperations = useMutation(api.domains.integrations.spreadsheets.applyOperations);
  const applyDCFEdit = useAction(api.domains.financial.dcfSpreadsheetAdapter.applyDCFSpreadsheetCellEdit);

  const [data, setData] = useState<Cell[][]>([]);
  const prevValuesRef = useRef<string[][]>([]);

  const matrix = useMemo(() => {
    const cellMap = new Map<string, string>();
    let maxRow = 0;
    let maxCol = 0;
    for (const c of cells ?? []) {
      maxRow = Math.max(maxRow, c.row);
      maxCol = Math.max(maxCol, c.col);
      cellMap.set(`${c.row},${c.col}`, c.value ?? "");
    }

    const rows = Math.max(maxRow + 1, 24);
    const cols = Math.max(maxCol + 1, 3);
    const isLinkedDCF = Boolean((sheet as any)?.dcfSessionId);

    const next: Cell[][] = Array.from({ length: rows }, (_v, r) =>
      Array.from({ length: cols }, (_v2, c) => {
        const value = cellMap.get(`${r},${c}`) ?? "";
        const readOnly = isLinkedDCF ? !isEditableDCFCell(r, c) : false;
        return { value, readOnly };
      }),
    );
    return next;
  }, [cells, sheet]);

  useEffect(() => {
    setData(matrix);
    prevValuesRef.current = matrix.map((row) => row.map((cell) => String(cell?.value ?? "")));
  }, [matrix]);

  const handleChange = async (next: any) => {
    const nextValues = next.map((row: any[]) => row.map((cell: any) => String(cell?.value ?? "")));
    const prev = prevValuesRef.current;

    let changed: { row: number; col: number; value: string } | null = null;
    for (let r = 0; r < nextValues.length && !changed; r++) {
      for (let c = 0; c < nextValues[r].length; c++) {
        const before = prev?.[r]?.[c] ?? "";
        const after = nextValues[r][c] ?? "";
        if (before !== after) {
          changed = { row: r, col: c, value: after };
          break;
        }
      }
    }

    setData(next as any);
    prevValuesRef.current = nextValues;

    if (!changed) return;

    const isLinkedDCF = Boolean((sheet as any)?.dcfSessionId);
    try {
      if (isLinkedDCF) {
        const res = await applyDCFEdit({
          spreadsheetId: sheetId,
          row: changed.row,
          col: changed.col,
          newValue: changed.value,
        });
        if (!res.recalculated) {
          toast.message("Saved", { description: "Cell updated." });
        }
      } else {
        await applyOperations({
          sheetId,
          operations: [
            {
              op: "setCell",
              row: changed.row,
              col: changed.col,
              value: changed.value,
              type: "text",
            },
          ],
        });
        toast.message("Saved", { description: "Cell updated." });
      }
    } catch (e) {
      console.warn("[SpreadsheetSheetView] update failed", e);
      toast.error("Failed to update cell");
    }
  };

  return (
    <div className="h-full flex flex-col bg-surface">
      <div className="h-14 border-b border-edge bg-surface px-4 flex items-center gap-3">
        <button
          type="button"
          className="p-2 rounded-md hover:bg-surface-hover"
          onClick={onBack}
          title="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-content truncate">
            {sheet?.name || "Spreadsheet"}
          </div>
          <div className="text-xs text-content-secondary truncate">
            {((sheet as any)?.dcfSessionId ? "Linked to DCF session" : "Unlinked spreadsheet")}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="px-3 py-1.5 text-xs rounded-md border border-edge bg-surface-secondary hover:bg-surface-hover"
            onClick={() => {
              openWithContext({
                contextTitle: sheet?.name || "Spreadsheet",
                initialMessage: `Edit this DCF spreadsheet.\nSpreadsheet ID: ${String(sheetId)}\n\nUser request:`,
              });
            }}
            title="Open Fast Agent with this spreadsheet ID"
          >
            Ask Agent
          </button>
          <button
            type="button"
            className="p-2 rounded-md hover:bg-surface-hover"
            onClick={() => {
              toast.message("Refreshed");
            }}
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-5xl mx-auto">
          <div className="overflow-auto border border-edge rounded-md bg-surface">
            <Spreadsheet
              data={data as any}
              DataEditor={MultiLineDataEditor}
              onChange={handleChange}
            />
          </div>
          <div className="text-xs text-content-secondary mt-3">
            {((sheet as any)?.dcfSessionId
              ? "Editable inputs are in column B (Value). Outputs auto-refresh after recalculation."
              : "This sheet is not linked to a DCF session.")}
          </div>
        </div>
      </div>
    </div>
  );
}
