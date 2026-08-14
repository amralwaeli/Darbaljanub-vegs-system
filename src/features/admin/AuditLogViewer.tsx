import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAuditLog, fetchUsers } from "../../lib/api/admin";
import { Modal } from "../../components/Modal";
import { Badge, Card, EmptyState, SkeletonList } from "../../components/ui";
import { fmtTime } from "../../lib/format";
import { t } from "../../i18n/strings";
import type { AuditEntry } from "../../lib/types";

const ACTION_COLOR: Record<string, "green" | "blue" | "red"> = {
  INSERT: "green",
  UPDATE: "blue",
  DELETE: "red",
};

/** Superadmin-only: who changed what and when (RLS blocks everyone else). */
export function AuditLogViewer() {
  const [detail, setDetail] = useState<AuditEntry | null>(null);

  const { data: entries, isLoading } = useQuery({
    queryKey: ["audit"],
    queryFn: () => fetchAuditLog(200),
  });
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: fetchUsers });

  const actorName = (id: string | null) =>
    (users ?? []).find((u) => u.id === id)?.username ?? (id ? id.slice(0, 8) : "system");

  if (isLoading) return <SkeletonList />;

  if ((entries ?? []).length === 0) {
    return <EmptyState emoji="📜" message={t.nothingHere} />;
  }

  return (
    <>
      <div className="space-y-2">
        {(entries ?? []).map((entry) => (
          <Card key={entry.id}>
            <button
              className="w-full text-start"
              onClick={() => setDetail(entry)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">
                  {entry.table_name}
                </span>
                <Badge color={ACTION_COLOR[entry.action] ?? "blue"}>
                  {entry.action}
                </Badge>
              </div>
              <div className="mt-1 text-xs text-gray-400">
                {t.auditWho}: {actorName(entry.actor_id)} · {t.auditWhen}:{" "}
                {fmtTime(entry.created_at)}
              </div>
            </button>
          </Card>
        ))}
      </div>

      <Modal
        open={detail !== null}
        title={`${detail?.table_name ?? ""} — ${detail?.action ?? ""}`}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <div className="space-y-3 text-xs">
            <div>
              <span className="font-semibold text-gray-500">
                {t.auditWho}:
              </span>{" "}
              {actorName(detail.actor_id)} · {fmtTime(detail.created_at)}
            </div>
            {detail.old_data !== null && (
              <div>
                <div className="mb-1 font-semibold text-gray-500">
                  {t.auditBefore}
                </div>
                <pre className="max-h-40 overflow-auto rounded-lg bg-red-50 p-2">
                  {JSON.stringify(detail.old_data, null, 2)}
                </pre>
              </div>
            )}
            {detail.new_data !== null && (
              <div>
                <div className="mb-1 font-semibold text-gray-500">
                  {t.auditAfter}
                </div>
                <pre className="max-h-40 overflow-auto rounded-lg bg-green-50 p-2">
                  {JSON.stringify(detail.new_data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
