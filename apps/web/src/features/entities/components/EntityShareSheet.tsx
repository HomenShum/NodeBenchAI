import type { ReactNode } from "react";
import { CheckCircle2, Link2, PencilLine, Users } from "lucide-react";

type ShareAccess = "view" | "edit";

type ShareLinkState = {
  token: string;
  access: ShareAccess;
} | null | undefined;

type WorkspaceMember = {
  userId: string;
  email: string;
  name?: string;
  image?: string;
  access: ShareAccess;
  token: string;
  notificationStatus?: "sent" | "link_only";
  notificationUpdatedAt?: number;
  notificationError?: string;
};

type WorkspaceInvite = {
  id: string;
  email: string;
  access: ShareAccess;
  token: string;
  notificationStatus?: "sent" | "link_only";
  notificationUpdatedAt?: number;
  notificationError?: string;
};

type Props = {
  entitySlug: string;
  viewLink?: ShareLinkState;
  editLink?: ShareLinkState;
  busyAccess: ShareAccess | null;
  copyState: ShareAccess | null;
  onCopyOrCreate: (access: ShareAccess) => void;
  onRevoke: (access: ShareAccess) => void;
  canManageMembers: boolean;
  peopleAuthSlot?: ReactNode;
  inviteEmail: string;
  inviteAccess: ShareAccess;
  inviteBusy: boolean;
  collaboratorCopyKey: string | null;
  onInviteEmailChange: (value: string) => void;
  onInviteAccessChange: (access: ShareAccess) => void;
  onInvite: () => void;
  members: WorkspaceMember[];
  invites: WorkspaceInvite[];
  onCopyMemberLink: (userId: string) => void;
  onCopyInviteLink: (inviteId: string) => void;
  onUpdateMemberAccess: (userId: string, access: ShareAccess) => void;
  onUpdateInviteAccess: (inviteId: string, access: ShareAccess) => void;
  onRevokeMember: (userId: string) => void;
  onRevokeInvite: (inviteId: string) => void;
};

function accessLabel(access: ShareAccess) {
  return access === "edit" ? "Can edit" : "Can view";
}

function formatRelativeTime(ts?: number) {
  if (!ts) return null;
  const deltaMs = Date.now() - ts;
  if (deltaMs < 60_000) return "just now";
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function deliveryStatusText(args: {
  status?: "sent" | "link_only";
  updatedAt?: number;
  error?: string;
}) {
  if (!args.status) return null;
  const relative = formatRelativeTime(args.updatedAt);
  if (args.status === "sent") {
    return relative ? `Email sent ${relative}` : "Email sent";
  }
  if (args.error) {
    return relative
      ? `Email unavailable, secure link ready ${relative}`
      : "Email unavailable, secure link ready";
  }
  return relative ? `Secure link ready ${relative}` : "Secure link ready";
}

function ShareRow({
  access,
  title,
  description,
  link,
  busyAccess,
  copyState,
  onCopyOrCreate,
  onRevoke,
}: {
  access: ShareAccess;
  title: string;
  description: string;
  link?: ShareLinkState;
  busyAccess: ShareAccess | null;
  copyState: ShareAccess | null;
  onCopyOrCreate: (access: ShareAccess) => void;
  onRevoke: (access: ShareAccess) => void;
}) {
  const Icon = access === "edit" ? PencilLine : Link2;
  return (
    <div
      data-testid={`entity-share-row-${access}`}
      className="flex items-center justify-between gap-4 rounded-2xl border border-black/8 bg-black/[0.02] px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium text-content">
          <Icon className="h-4 w-4 text-content-muted" />
          {title}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-content-muted">
          <span>{description}</span>
          {link ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3 w-3" />
              {accessLabel(access)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          data-testid={`entity-share-copy-${access}`}
          onClick={() => onCopyOrCreate(access)}
          className="nb-primary-button rounded-full px-3 py-1.5 text-xs"
        >
          {busyAccess === access
            ? "Working..."
            : copyState === access
              ? "Copied"
              : link
                ? "Copy link"
                : "Create link"}
        </button>
        {link ? (
          <button
            type="button"
            data-testid={`entity-share-revoke-${access}`}
            onClick={() => onRevoke(access)}
            className="nb-secondary-button rounded-full px-3 py-1.5 text-xs"
          >
            Revoke
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PersonRow({
  label,
  secondary,
  access,
  onAccessChange,
  onCopyLink,
  onRemove,
  testId,
  copied,
  statusText,
}: {
  label: string;
  secondary: string;
  access: ShareAccess;
  onAccessChange: (access: ShareAccess) => void;
  onCopyLink: () => void;
  onRemove: () => void;
  testId: string;
  copied: boolean;
  statusText?: string | null;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-3 rounded-2xl border border-black/8 bg-black/[0.02] px-4 py-3 dark:border-white/10 dark:bg-white/[0.03] lg:flex-row lg:items-center lg:justify-between"
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-content">{label}</div>
        <div className="mt-1 text-xs text-content-muted">{secondary}</div>
        {statusText ? <div className="mt-1 text-[11px] text-content-muted">{statusText}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <select
          value={access}
          onChange={(event) => onAccessChange(event.target.value as ShareAccess)}
          className="rounded-full border border-black/8 bg-white px-3 py-1.5 text-xs text-content outline-none dark:border-white/10 dark:bg-[#15161a]"
        >
          <option value="view">Can view</option>
          <option value="edit">Can edit</option>
        </select>
        <button
          type="button"
          onClick={onCopyLink}
          className="nb-secondary-button rounded-full px-3 py-1.5 text-xs"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="nb-secondary-button rounded-full px-3 py-1.5 text-xs"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export function EntityShareSheet({
  entitySlug: _entitySlug,
  viewLink,
  editLink,
  busyAccess,
  copyState,
  onCopyOrCreate,
  onRevoke,
  canManageMembers,
  peopleAuthSlot,
  inviteEmail,
  inviteAccess,
  inviteBusy,
  collaboratorCopyKey,
  onInviteEmailChange,
  onInviteAccessChange,
  onInvite,
  members,
  invites,
  onCopyMemberLink,
  onCopyInviteLink,
  onUpdateMemberAccess,
  onUpdateInviteAccess,
  onRevokeMember,
  onRevokeInvite,
}: Props) {
  const showPeopleSection = canManageMembers || Boolean(peopleAuthSlot);

  return (
    <section
      data-testid="entity-share-sheet"
      className="mt-4 space-y-4 rounded-3xl border border-black/8 bg-white/90 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-[#111214]/92"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-content">Share</div>
          <p className="mt-1 text-sm leading-6 text-content-muted">
            Create a link for anyone, or send a named invite. If email delivery fails, the secure link is still ready to copy.
          </p>
        </div>
        <div className="rounded-full border border-black/8 bg-black/[0.03] px-2.5 py-1 text-[11px] font-medium text-content-muted dark:border-white/10 dark:bg-white/[0.04]">
          Simple access
        </div>
      </div>

      <div className="space-y-3">
        <ShareRow
          access="view"
          title="View link"
          description="Read the report, notes, and notebook."
          link={viewLink}
          busyAccess={busyAccess}
          copyState={copyState}
          onCopyOrCreate={onCopyOrCreate}
          onRevoke={onRevoke}
        />
        <ShareRow
          access="edit"
          title="Edit link"
          description="Edit working notes and the live notebook."
          link={editLink}
          busyAccess={busyAccess}
          copyState={copyState}
          onCopyOrCreate={onCopyOrCreate}
          onRevoke={onRevoke}
        />
      </div>

      {showPeopleSection ? (
        <section className="rounded-2xl border border-black/8 bg-black/[0.015] p-4 dark:border-white/10 dark:bg-white/[0.02]">
          <div className="flex items-center gap-2 text-sm font-semibold text-content">
            <Users className="h-4 w-4 text-content-muted" />
            People
          </div>
          <p className="mt-1 text-sm text-content-muted">
            Give named people view or edit access. NodeBench sends the email now and falls back to a secure copyable link only when delivery is unavailable.
          </p>

          {canManageMembers ? (
            <>
              <div className="mt-4 flex flex-col gap-2 lg:flex-row">
                <input
                  data-testid="entity-share-invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => onInviteEmailChange(event.target.value)}
                  placeholder="teammate@example.com"
                  className="min-w-0 flex-1 rounded-2xl border border-black/8 bg-white px-3 py-2 text-sm text-content outline-none placeholder:text-content-muted dark:border-white/10 dark:bg-[#15161a]"
                />
                <select
                  data-testid="entity-share-invite-access"
                  value={inviteAccess}
                  onChange={(event) => onInviteAccessChange(event.target.value as ShareAccess)}
                  className="rounded-2xl border border-black/8 bg-white px-3 py-2 text-sm text-content outline-none dark:border-white/10 dark:bg-[#15161a]"
                >
                  <option value="view">Can view</option>
                  <option value="edit">Can edit</option>
                </select>
                <button
                  type="button"
                  data-testid="entity-share-invite-submit"
                  onClick={onInvite}
                  disabled={inviteBusy || inviteEmail.trim().length === 0}
                  className="nb-primary-button rounded-2xl px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {inviteBusy ? "Working..." : "Send invite"}
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {members.length === 0 && invites.length === 0 ? (
                  <div
                    data-testid="entity-share-empty-state"
                    className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-5 dark:border-white/10 dark:bg-white/[0.03]"
                  >
                    <div className="text-sm font-medium text-content">Invite your first collaborator</div>
                    <div className="mt-1 text-sm leading-6 text-content-muted">
                      Add one email above and send it. If email delivery is unavailable, NodeBench copies the secure link so you can forward it yourself.
                    </div>
                  </div>
                ) : null}
                {members.map((member) => (
                  <PersonRow
                    key={member.userId}
                    testId={`entity-share-member-${member.userId}`}
                    label={member.name?.trim() || member.email}
                    secondary={`Member - ${member.email}`}
                    statusText={deliveryStatusText({
                      status: member.notificationStatus,
                      updatedAt: member.notificationUpdatedAt,
                      error: member.notificationError,
                    })}
                    access={member.access}
                    onAccessChange={(access) => onUpdateMemberAccess(member.userId, access)}
                    onCopyLink={() => onCopyMemberLink(member.userId)}
                    onRemove={() => onRevokeMember(member.userId)}
                    copied={
                      collaboratorCopyKey === `member:${member.userId}` ||
                      collaboratorCopyKey === `member:${member.email.toLowerCase()}`
                    }
                  />
                ))}
                {invites.map((invite) => (
                  <PersonRow
                    key={invite.id}
                    testId={`entity-share-invite-${invite.id}`}
                    label={invite.email}
                    secondary="Pending invite"
                    statusText={deliveryStatusText({
                      status: invite.notificationStatus,
                      updatedAt: invite.notificationUpdatedAt,
                      error: invite.notificationError,
                    })}
                    access={invite.access}
                    onAccessChange={(access) => onUpdateInviteAccess(invite.id, access)}
                    onCopyLink={() => onCopyInviteLink(invite.id)}
                    onRemove={() => onRevokeInvite(invite.id)}
                    copied={
                      collaboratorCopyKey === `invite:${invite.id}` ||
                      collaboratorCopyKey === `invite:${invite.email.toLowerCase()}`
                    }
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-black/10 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
              {peopleAuthSlot}
            </div>
          )}
        </section>
      ) : null}
    </section>
  );
}

export default EntityShareSheet;
