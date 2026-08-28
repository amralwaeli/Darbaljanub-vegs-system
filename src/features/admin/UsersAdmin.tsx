import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import {
  fetchStores,
  fetchUsers,
  inviteUser,
  reinviteUser,
  setUserActive,
} from "../../lib/api/admin";
import { Modal, ConfirmDialog } from "../../components/Modal";
import {
  Badge,
  Button,
  Card,
  Input,
  Select,
  SkeletonList,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { ApiError } from "../../lib/api/helpers";
import { fmtTime } from "../../lib/format";
import { normalizeEmail } from "../../lib/text";
import { t } from "../../i18n/strings";
import type { ProfileWithStore } from "../../lib/types";
import type { UserRole } from "../../lib/database.types";

export function UsersAdmin() {
  const { profile: me } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("pic");
  const [storeId, setStoreId] = useState("");
  const [confirmAction, setConfirmAction] = useState<
    | { kind: "deactivate"; user: ProfileWithStore }
    | { kind: "reset"; user: ProfileWithStore }
    | null
  >(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers,
  });
  const { data: stores } = useQuery({
    queryKey: ["stores"],
    queryFn: fetchStores,
  });

  const isSuperadmin = me?.role === "superadmin";

  const onApiError = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : t.errorGeneric);

  const invalidateUsers = () =>
    queryClient.invalidateQueries({ queryKey: ["users"] });

  const inviteMutation = useMutation({
    mutationFn: () =>
      inviteUser({
        email: email.trim().toLowerCase(),
        role,
        store_id: role === "pic" ? storeId : null,
      }),
    onSuccess: () => {
      toast.success(t.inviteSent);
      setInviteOpen(false);
      setEmail("");
      void invalidateUsers();
    },
    onError: onApiError,
  });

  const activeMutation = useMutation({
    mutationFn: ({ user, active }: { user: ProfileWithStore; active: boolean }) =>
      setUserActive(user.id, active),
    onSuccess: () => {
      toast.success(t.updated);
      setConfirmAction(null);
      void invalidateUsers();
    },
    onError: (e) => {
      setConfirmAction(null);
      onApiError(e);
    },
  });

  const resetMutation = useMutation({
    // Reset needs the user's login email, which lives in auth (not profiles).
    // The superadmin types/copies it — here we only have the profile row, so
    // we prompt via the confirm dialog flow with a known email when possible.
    mutationFn: (userEmail: string) => reinviteUser(userEmail),
    onSuccess: () => {
      toast.success(t.resetSent);
      setConfirmAction(null);
    },
    onError: (e) => {
      setConfirmAction(null);
      onApiError(e);
    },
  });

  // Managers cannot touch managers/superadmins (server enforces this too).
  const canManage = (user: ProfileWithStore) =>
    user.id !== me?.id &&
    (isSuperadmin || user.role === "pic" || user.role === "driver");

  if (isLoading) return <SkeletonList />;

  return (
    <>
      <div className="space-y-2">
        {(users ?? []).map((user) => (
          <Card key={user.id}>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <div className="font-semibold">
                  {user.username ?? t.noNameYet}{" "}
                  <Badge
                    color={
                      user.role === "superadmin"
                        ? "red"
                        : user.role === "manager"
                          ? "blue"
                          : user.role === "pic"
                            ? "green"
                            : "amber"
                    }
                  >
                    {t.roles[user.role]}
                  </Badge>{" "}
                  {!user.is_active && <Badge color="red">{t.inactive}</Badge>}
                </div>
                <div className="text-xs text-gray-400">
                  {user.store ? `🏪 ${user.store.name} · ` : ""}
                  {t.lastLogin}:{" "}
                  {user.last_login_at ? fmtTime(user.last_login_at) : t.never}
                </div>
              </div>
            </div>
            {canManage(user) && (
              <div className="mt-2 flex gap-2">
                {user.is_active ? (
                  <Button
                    variant="ghost"
                    className="flex-1 text-red-600"
                    onClick={() =>
                      setConfirmAction({ kind: "deactivate", user })
                    }
                  >
                    {t.deactivate}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    className="flex-1"
                    busy={activeMutation.isPending}
                    onClick={() =>
                      activeMutation.mutate({ user, active: true })
                    }
                  >
                    {t.reactivate}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="flex-1"
                  onClick={() => setConfirmAction({ kind: "reset", user })}
                >
                  {t.resetPin}
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>

      <Button className="mt-4 w-full" onClick={() => setInviteOpen(true)}>
        ✉️ {t.inviteUser}
      </Button>

      {/* ------------------------------------------------ invite modal ---- */}
      <Modal
        open={inviteOpen}
        title={t.inviteUser}
        onClose={() => setInviteOpen(false)}
      >
        <div className="space-y-4">
          <Input
            label={t.email}
            type="text"
            dir="ltr"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(normalizeEmail(e.target.value))}
          />
          <Select
            label={t.inviteRole}
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
          >
            <option value="pic">{t.roles.pic}</option>
            <option value="driver">{t.roles.driver}</option>
            <option value="manager">{t.roles.manager}</option>
            {isSuperadmin && (
              <option value="superadmin">{t.roles.superadmin}</option>
            )}
          </Select>
          {role === "pic" && (
            <Select
              label={t.inviteStore}
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              <option value="">—</option>
              {(stores ?? [])
                .filter((s) => s.is_active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          )}
          <Button
            className="w-full"
            busy={inviteMutation.isPending}
            disabled={
              !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
              (role === "pic" && !storeId)
            }
            onClick={() => inviteMutation.mutate()}
          >
            {t.sendInvite}
          </Button>
        </div>
      </Modal>

      {/* --------------------------------------------- deactivate confirm - */}
      <ConfirmDialog
        open={confirmAction?.kind === "deactivate"}
        title={t.deactivate}
        message={t.deactivateConfirm}
        danger
        busy={activeMutation.isPending}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() =>
          confirmAction &&
          activeMutation.mutate({ user: confirmAction.user, active: false })
        }
      />

      {/* ------------------------------------------------ reset PIN flow -- */}
      <ResetPinDialog
        user={confirmAction?.kind === "reset" ? confirmAction.user : null}
        busy={resetMutation.isPending}
        onCancel={() => setConfirmAction(null)}
        onConfirm={(userEmail) => resetMutation.mutate(userEmail)}
      />
    </>
  );
}

/**
 * PIN reset asks for the user's login email explicitly (profiles do not store
 * emails — they live in Supabase Auth). Prevents resetting the wrong account.
 */
function ResetPinDialog({
  user,
  busy,
  onCancel,
  onConfirm,
}: {
  user: ProfileWithStore | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  return (
    <Modal open={user !== null} title={t.resetPin} onClose={onCancel}>
      <p className="mb-3 text-sm text-gray-600">{t.resetPinConfirm}</p>
      <div className="space-y-4">
        <Input
          label={t.email}
          type="text"
          dir="ltr"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(normalizeEmail(e.target.value))}
        />
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>
            {t.cancel}
          </Button>
          <Button
            className="flex-1"
            busy={busy}
            disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}
            onClick={() => onConfirm(email.trim().toLowerCase())}
          >
            {t.resetPin}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
