import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Download, Upload } from "lucide-react";

import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import { Alert, Table, Td, Textarea, Th } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/useToast";
import { createEvents, fetchEventCategories } from "@/services/events";
import { queryKeys } from "@/services/queryKeys";
import { eventCsvTemplate, parseEventCsv, type ImportResult } from "./eventImport";
import { formatShortDate, formatTime } from "@/lib/datetime";
import { errorText } from "@/lib/errors";
import { cn } from "@/lib/utils";

/**
 * Bulk event creation from a spreadsheet.
 *
 * Three steps, on purpose: choose a file, **look at what it parsed**, then
 * import. The preview is the whole point — a semester of GBMs entered in one
 * go is also a semester of mistakes entered in one go, and an officer should
 * see the parsed dates before anything is written.
 *
 * Everything happens in the browser and goes in through the same RLS-guarded
 * insert the event form uses. No new backend, no elevated path.
 */
export function EventCsvImportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [raw, setRaw] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const categories = useQuery({
    queryKey: queryKeys.eventCategories,
    queryFn: fetchEventCategories,
    staleTime: 30 * 60_000,
  });

  const reset = () => {
    setRaw("");
    setResult(null);
    setParseError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const close = () => {
    reset();
    onClose();
  };

  const analyse = (text: string) => {
    setParseError(null);
    if (!text.trim()) {
      setResult(null);
      return;
    }
    try {
      const parsed = parseEventCsv(text, categories.data ?? []);
      if (parsed.rows.length === 0) {
        setParseError("That file has a header row but no events under it.");
        setResult(null);
        return;
      }
      setResult(parsed);
    } catch (error) {
      setParseError(errorText(error, "We couldn't read that file"));
      setResult(null);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setRaw(text);
    analyse(text);
  };

  const importEvents = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      const payloads = (result?.valid ?? []).map((row) => row.payload!);
      return createEvents(payloads, user.id);
    },
    onSuccess: (created) => {
      toast.success(
        `Imported ${created.length} ${created.length === 1 ? "event" : "events"}`,
        "They were created as drafts unless the file said otherwise — publish them when you're ready.",
      );
      void queryClient.invalidateQueries({ queryKey: ["events"] });
      close();
    },
    onError: (error) => toast.error("We couldn't import those events", errorText(error)),
  });

  const downloadTemplate = () => {
    const blob = new Blob([eventCsvTemplate()], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "shpe-events-template.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const validCount = result?.valid.length ?? 0;
  const invalidCount = result?.invalid.length ?? 0;

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Import events from a spreadsheet"
      description="Useful for entering a whole semester at once. Everything imports as a draft unless the file says otherwise."
      size="lg"
      footer={
        <>
          <Button variant="subtle" onClick={close} disabled={importEvents.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => importEvents.mutate()}
            loading={importEvents.isPending}
            disabled={validCount === 0}
          >
            {validCount === 0
              ? "Nothing to import"
              : `Import ${validCount} ${validCount === 1 ? "event" : "events"}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4" aria-hidden />
            Choose a CSV file
          </Button>
          <Button variant="ghost" size="sm" onClick={downloadTemplate}>
            <Download className="h-4 w-4" aria-hidden />
            Download a template
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label="CSV file of events"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </div>

        <details className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-shpe-navy">
            Or paste the rows directly
          </summary>
          <Textarea
            className="mt-3 font-mono text-xs"
            rows={6}
            value={raw}
            aria-label="Paste CSV rows"
            placeholder="title,category,start,end,location,points"
            onChange={(e) => {
              setRaw(e.target.value);
              analyse(e.target.value);
            }}
          />
        </details>

        <p className="text-xs text-gray-600">
          Required columns: <strong>title</strong>, <strong>category</strong>,{" "}
          <strong>start</strong>, <strong>end</strong>. Dates are{" "}
          <code>YYYY-MM-DD HH:MM</code> in St. Louis time. Optional:{" "}
          <code>location</code>, <code>points</code>, <code>status</code>,{" "}
          <code>is_public</code>, <code>description</code>, <code>capacity</code>,{" "}
          <code>organizer_name</code>, <code>organizer_email</code>.
        </p>

        {parseError && <Alert tone="danger">{parseError}</Alert>}

        {result && result.unknownHeaders.length > 0 && (
          <Alert tone="warning" title="Some columns were ignored">
            {result.unknownHeaders.join(", ")} — check the spelling if one of those was meant to
            be used.
          </Alert>
        )}

        {result && (
          <>
            <div aria-live="polite" className="flex flex-wrap gap-3 text-sm">
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                {validCount} ready to import
              </span>
              {invalidCount > 0 && (
                <span className="inline-flex items-center gap-1.5 font-medium text-red-700">
                  <AlertCircle className="h-4 w-4" aria-hidden />
                  {invalidCount} will be skipped
                </span>
              )}
            </div>

            <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200">
              <Table caption="Preview of the events in this file, with any problems found">
                <thead className="sticky top-0 bg-white">
                  <tr>
                    <Th>Row</Th>
                    <Th>Event</Th>
                    <Th>When</Th>
                    <Th>Result</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.line} className={cn(row.payload === null && "bg-red-50")}>
                      <Td className="text-gray-500">{row.line}</Td>
                      <Td className="font-medium text-shpe-navy">{row.title}</Td>
                      <Td className="whitespace-nowrap text-gray-700">
                        {row.payload ? (
                          <>
                            {formatShortDate(row.payload.start_at)}
                            <span className="block text-xs text-gray-500">
                              {formatTime(row.payload.start_at)}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td>
                        {row.payload ? (
                          <span className="text-emerald-700">
                            {row.payload.points_value} pts · {row.payload.status}
                            {!row.payload.is_public && " · internal"}
                          </span>
                        ) : (
                          <ul className="space-y-0.5 text-red-800">
                            {row.errors.map((error) => (
                              <li key={error}>{error}</li>
                            ))}
                          </ul>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
