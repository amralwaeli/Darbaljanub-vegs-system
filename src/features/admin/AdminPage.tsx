import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { PageTitle } from "../../components/ui";
import { StoresAdmin } from "./StoresAdmin";
import { ItemsAdmin } from "./ItemsAdmin";
import { VendorsAdmin } from "./VendorsAdmin";
import { CategoriesAdmin } from "./CategoriesAdmin";
import { UsersAdmin } from "./UsersAdmin";
import { AuditLogViewer } from "./AuditLogViewer";
import { t } from "../../i18n/strings";

type TabKey =
  | "stores"
  | "items"
  | "categories"
  | "vendors"
  | "users"
  | "audit";

export default function AdminPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<TabKey>("stores");

  const tabs: { key: TabKey; label: string }[] = [
    { key: "stores", label: t.stores },
    { key: "items", label: t.items },
    { key: "categories", label: t.categories },
    { key: "vendors", label: t.vendors },
    { key: "users", label: t.users },
    // Audit trail is superadmin-only (RLS enforces it regardless).
    ...(profile?.role === "superadmin"
      ? [{ key: "audit" as TabKey, label: t.audit }]
      : []),
  ];

  return (
    <>
      <PageTitle>{t.adminTitle}</PageTitle>
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-gray-200/60 p-1">
        {tabs.map((item) => (
          <button
            key={item.key}
            className={`min-h-10 flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors ${
              tab === item.key
                ? "bg-white text-brand-700 shadow-sm"
                : "text-gray-500"
            }`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "stores" && <StoresAdmin />}
      {tab === "items" && <ItemsAdmin />}
      {tab === "categories" && <CategoriesAdmin />}
      {tab === "vendors" && <VendorsAdmin />}
      {tab === "users" && <UsersAdmin />}
      {tab === "audit" && <AuditLogViewer />}
    </>
  );
}
