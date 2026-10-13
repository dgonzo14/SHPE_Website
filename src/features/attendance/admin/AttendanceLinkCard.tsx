import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Copy, Download, Link2, Maximize2, RefreshCw } from "lucide-react";

import { Button, LinkButton } from "@/components/ui/button";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
} from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ErrorState, SkeletonList } from "@/components/shared/states";
import { useToast } from "@/components/ui/useToast";
import { downloadBlob, qrPngBlob, qrSvg } from "@/features/cards/qr";
import { copyText } from "@/features/cards/share";
import { PLAIN_QR_COLORS } from "@/features/cards/editor/share/qrColors";
import {
  attendanceFormUrl,
  createAttendanceLink,
  rotateAttendanceLink,
} from "@/services/attendanceForm";
import { queryKeys } from "@/services/queryKeys";
import { formatDateTime } from "@/lib/datetime";
import { errorText } from "@/lib/errors";
import type { AttendanceLinkStatus, EventRow } from "@/types/database";
import { attendanceWindowStatus, type AttendanceWindowStatus } from "./attendanceWindow";
import { QrPresenter } from "./QrPresenter";
import { useAttendanceLink } from "./useAttendanceForm";
import { useNow } from "./useNow";

export type AttendanceLinkEvent = Pick<
  EventRow,
  | "id"
  | "title"
  | "slug"
  | "status"
  | "start_at"
  | "end_at"
  | "check_in_opens_at"
  | "check_in_closes_at"
>;

/** Pixels per module for the PNG: about 700 px square, enough for a slide or a poster. */
const PNG_SCALE = 16;

/** "boeing-networking-night", for download file names. */
function fileStem(event: AttendanceLinkEvent): string {
  const stem = (event.slug || event.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return stem || "event";
}

/**
 * The attendance form's controls on an event's roster: create the link, copy
 * it, show or download its QR code, and replace it.
 *
 * The link is the only credential the form has (anyone holding it can check
 * in while the window is open), which is why replacing it sits behind a
 * confirmation that says what breaks, and why the hint suggests sharing it at
 * the event rather than ahead of it. It is not shown-once like the check-in
 * code: a QR code goes on slides and gets reused all meeting, and officers can
 * already add attendance by hand, so hiding it from them protects nothing.
 *
 * Creating and replacing are different calls. Two officers often open the
 * roster before a meeting and both see "no link yet"; Create never replaces,
 * so the second press hands back the first officer's link instead of killing
 * the QR code already on their screen. The card also re-reads the link every
 * minute, so a laptop projecting the code picks up a replacement another
 * officer made rather than showing a dead code for the rest of the meeting.
 */
export function AttendanceLinkCard({
  event,
  className,
}: {
  event: AttendanceLinkEvent;
  className?: string;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  // This card is the page's one watcher of the link (see useAttendanceForm).
  const link = useAttendanceLink(event.id, { watch: true });
  const now = useNow();
  const windowStatus = attendanceWindowStatus(event, now);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const linkKey = queryKeys.events.attendanceLink(event.id);

  /*
   * Both RPCs return the link as it now stands, so the answer goes straight
   * into the cache with nothing to refetch. A read of the link already on its
   * way is cancelled first: the minute's poll may have left before the change
   * committed, and landing after this it would put the old link back on
   * screen (a dead QR code, after a replacement) until the next poll.
   */
  const showLink = async (status: AttendanceLinkStatus) => {
    await queryClient.cancelQueries({ queryKey: linkKey });
    queryClient.setQueryData(linkKey, status);
  };

  const create = useMutation({
    mutationFn: () => createAttendanceLink(event.id),
    onSuccess: async (status) => {
      await showLink(status);
      if (status.created === false) {
        // Not an error: this officer's page was out of date, and the link
        // that came back is the one already being shared.
        toast.info(
          "Another officer already made the link",
          "This is it. Nothing was replaced, so any copies already shared still work.",
        );
      } else {
        toast.success("Attendance link created", "Share the link or show the QR code at the event.");
      }
    },
    onError: (error) => toast.error("We couldn't create the link", errorText(error)),
  });

  const replace = useMutation({
    mutationFn: () => rotateAttendanceLink(event.id),
    onSuccess: async (status) => {
      await showLink(status);
      setConfirmReplace(false);
      toast.success(
        "Attendance link replaced",
        "The old link and its QR code have stopped working. Share this one instead.",
      );
    },
    onError: (error) => {
      setConfirmReplace(false);
      toast.error("We couldn't replace the link", errorText(error));
    },
  });

  const token = link.data?.has_link ? link.data.token : null;

  return (
    <Card className={className}>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>Attendance form</CardTitle>
        {token && <Badge tone={windowStatus.tone}>{windowStatus.label}</Badge>}
      </CardHeader>
      <CardBody className="space-y-5">
        <p className="max-w-[70ch] text-sm text-gray-600">
          People check in with their name and email, no account needed. If the email belongs to an
          account, they go on the roster straight away. If not, they're listed as waiting for an
          account and added automatically once someone creates one with that email.
        </p>

        {link.isPending ? (
          <SkeletonList rows={1} />
        ) : link.isError ? (
          <ErrorState
            error={link.error}
            fallback="We couldn't load the attendance link"
            onRetry={() => void link.refetch()}
          />
        ) : token ? (
          <>
            <WindowLine eventId={event.id} status={windowStatus} />
            <LinkTools
              event={event}
              url={attendanceFormUrl(token)}
              updatedAt={link.data.updated_at}
              onReplace={() => setConfirmReplace(true)}
            />
          </>
        ) : (
          <div className="space-y-3">
            <Button onClick={() => create.mutate()} loading={create.isPending}>
              {!create.isPending && <Link2 className="h-4 w-4" aria-hidden="true" />}
              Create attendance link
            </Button>
            <p className="text-sm text-gray-600">
              It takes responses only during the event's check-in window, the same one the
              check-in code uses.
            </p>
          </div>
        )}
      </CardBody>

      <ConfirmDialog
        open={confirmReplace}
        onClose={() => setConfirmReplace(false)}
        onConfirm={() => replace.mutate()}
        loading={replace.isPending}
        title="Replace the attendance link?"
        description="The current link and every copy of its QR code stop working immediately, including any on slides, posters or in group chats. Anyone who hasn't checked in yet will need the new one."
        confirmLabel="Replace link"
      />
    </Card>
  );
}

/** When the form takes responses, and where to change that. */
function WindowLine({ eventId, status }: { eventId: string; status: AttendanceWindowStatus }) {
  const action =
    status.state === "draft"
      ? "Publish the event"
      : status.state === "cancelled" || status.state === "completed"
        ? "Edit event"
        : "Change the window";

  return (
    <div className="flex flex-col gap-3 border border-shpe-rule bg-shpe-navy-soft/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-sm">
        <p className="flex items-start gap-2 font-medium text-shpe-navy">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{status.message}</span>
        </p>
        <p className="mt-1 text-gray-600">
          The form uses the event's check-in window, the same one as the check-in code.
        </p>
      </div>
      <LinkButton to={`/admin/events/${eventId}`} variant="ghost" size="sm" className="shrink-0">
        {action}
      </LinkButton>
    </div>
  );
}

/**
 * The link, its QR code and the ways to share them. The code is drawn in the
 * browser (no third-party QR service sees the link) and shown through a data
 * URL, so the generated SVG never enters the DOM as markup. Black on white
 * rather than the chapter colours: it will be projected in rooms with the
 * lights on and scanned from the back row.
 */
function LinkTools({
  event,
  url,
  updatedAt,
  onReplace,
}: {
  event: AttendanceLinkEvent;
  url: string;
  updatedAt: string | null;
  onReplace: () => void;
}) {
  const toast = useToast();
  const [savingPng, setSavingPng] = useState(false);
  const [presenting, setPresenting] = useState(false);

  const svg = useMemo(
    () =>
      qrSvg(url, {
        fg: PLAIN_QR_COLORS.fg,
        bg: PLAIN_QR_COLORS.bg,
        margin: 4,
        title: `QR code for the ${event.title} attendance form`,
      }),
    [url, event.title],
  );
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const stem = fileStem(event);

  const copy = async () => {
    if (await copyText(url)) {
      toast.success("Link copied", "Paste it into the group chat, an email or your slides.");
    } else {
      toast.error("Couldn't copy the link", "Select the link and copy it yourself.");
    }
  };

  const downloadSvg = () => {
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${stem}-attendance-qr.svg`);
  };

  const downloadPng = async () => {
    setSavingPng(true);
    try {
      const blob = await qrPngBlob(url, {
        fg: PLAIN_QR_COLORS.fg,
        bg: PLAIN_QR_COLORS.bg,
        scale: PNG_SCALE,
        margin: 4,
      });
      downloadBlob(blob, `${stem}-attendance-qr.png`);
    } catch (error) {
      toast.error(
        "Couldn't make the PNG",
        error instanceof Error ? error.message : errorText(error),
      );
    } finally {
      setSavingPng(false);
    }
  };

  return (
    <>
      <div className="grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
        <div className="mx-auto w-full max-w-48 border border-shpe-rule bg-white p-2 sm:mx-0">
          <img
            src={src}
            alt={`QR code that opens the attendance form at ${url}`}
            width={192}
            height={192}
            className="block aspect-square h-auto w-full"
          />
        </div>

        <div className="min-w-0 space-y-4">
          <Field
            label="Attendance link"
            hint="Anyone with this link can check in while the window is open, so share it at the event rather than ahead of it."
          >
            {(props) => (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  {...props}
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 font-mono text-sm"
                />
                <Button variant="secondary" onClick={() => void copy()} className="shrink-0">
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  Copy link
                </Button>
              </div>
            )}
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setPresenting(true)}>
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
              Show QR full screen
            </Button>
            <Button variant="subtle" onClick={() => void downloadPng()} loading={savingPng}>
              {!savingPng && <Download className="h-4 w-4" aria-hidden="true" />}
              Download PNG
            </Button>
            <Button variant="subtle" onClick={downloadSvg}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Download SVG
            </Button>
          </div>
          <p className="text-sm text-gray-600">
            PNG for slides, SVG for anything printed, since it stays sharp at any size.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-shpe-rule pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-600">
          {updatedAt && <>This link was made {formatDateTime(updatedAt)}. </>}
          If it has ended up somewhere it shouldn't, replace it.
        </p>
        <Button variant="subtle" size="sm" onClick={onReplace} className="shrink-0">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Replace link
        </Button>
      </div>

      <QrPresenter
        open={presenting}
        onClose={() => setPresenting(false)}
        eventTitle={event.title}
        url={url}
        qrSrc={src}
      />
    </>
  );
}
