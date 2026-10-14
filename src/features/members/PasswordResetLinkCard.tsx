import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert, Card, CardBody, CardHeader, CardTitle, Input } from "@/components/ui/primitives";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/useToast";
import { copyText } from "@/features/cards/share";
import { createPasswordResetLink, type PasswordResetLink } from "@/services/admin";
import { memberName } from "@/services/members";
import { errorText } from "@/lib/errors";
import type { ProfileRow } from "@/types/database";

/**
 * A single-use password reset link an admin creates for a member and hands
 * over themselves, for when the reset email isn't getting through: WashU's
 * mail filtering holds it back or opens it first, and the emailed link only
 * works in the browser that asked for it.
 *
 * Who may do this is decided server-side, not here. The Netlify function
 * behind createPasswordResetLink() asks admin_password_reset_target() with the
 * admin's own session, which refuses non-admins and an admin's own account,
 * and it records the link in the audit log before returning it.
 */
export function PasswordResetLinkCard({
  member,
}: {
  member: Pick<ProfileRow, "id" | "first_name" | "last_name" | "email">;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const name = memberName(member);
  const firstName = member.first_name?.trim() || name;
  const [confirmOpen, setConfirmOpen] = useState(false);

  /*
   * The link the admin just made, kept in this component's state and nowhere
   * else.
   *
   * Until it's used or expires it is a working key to the member's account, so
   * it isn't put in the query cache, isn't logged, and is dropped as soon as
   * the dialog closes. gcTime 0 and reset() make react-query let go of its own
   * copy of the mutation result at the same moment. If the admin loses it they
   * make another, which cancels this one: that is the correct trade for never
   * keeping a recoverable copy.
   */
  const [created, setCreated] = useState<PasswordResetLink | null>(null);

  const create = useMutation({
    mutationFn: () => createPasswordResetLink(member.id),
    gcTime: 0,
    onSuccess: (result) => {
      setConfirmOpen(false);
      setCreated(result);
      // The function wrote an audit row before answering; show it there.
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit-log"] });
    },
    onError: (error) => {
      setConfirmOpen(false);
      toast.error("We couldn't create a reset link", errorText(error));
    },
  });

  const closeResult = () => {
    setCreated(null);
    create.reset();
  };

  const copy = async () => {
    if (!created) return;
    if (await copyText(created.link)) {
      toast.success("Link copied", `Send it to ${firstName} directly.`);
    } else {
      toast.error("Couldn't copy the link", "Select the link and copy it yourself.");
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Password reset link</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-gray-700">
            If {firstName} isn't getting the password reset email (WashU's mail filtering often
            holds it back), create a link here and send it to them yourself by text, Slack or in
            person. Opening it lets them choose a new password straight away.
          </p>
          <Button variant="secondary" className="mt-4" onClick={() => setConfirmOpen(true)}>
            <KeyRound className="h-4 w-4" aria-hidden />
            Create reset link
          </Button>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => create.mutate()}
        loading={create.isPending}
        destructive={false}
        confirmLabel="Create link"
        title={`Create a reset link for ${name}?`}
        description={
          <>
            <p>
              Anyone who opens the link can choose a new password for{" "}
              <strong className="break-all">{member.email}</strong> and sign in as {firstName}.
              Send it only to them, directly, once you're sure it's them.
            </p>
            <p className="mt-2">
              It works once, expires in about an hour, and cancels any earlier reset link.
              Creating it is recorded in the audit log.
            </p>
          </>
        }
      />

      <Dialog
        open={created !== null}
        onClose={closeResult}
        size="md"
        title={`Reset link for ${name}`}
        description={
          created ? (
            <>
              Resets the password for <strong className="break-all">{created.email}</strong>.
            </>
          ) : undefined
        }
        footer={<Button onClick={closeResult}>Done</Button>}
      >
        {created && (
          <div className="space-y-4">
            <Alert tone="warning" title="Copy it now">
              This is the only time it's shown. If you lose it, create a new one, which cancels
              this one. Send it only to {firstName}.
            </Alert>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                readOnly
                value={created.link}
                aria-label={`Password reset link for ${name}`}
                onFocus={(e) => e.currentTarget.select()}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 font-mono text-sm"
              />
              <Button variant="secondary" onClick={() => void copy()}>
                <Copy className="h-4 w-4" aria-hidden />
                Copy link
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
