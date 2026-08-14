import { NavLink } from "react-router-dom";
import { useAuth } from "../features/auth/AuthProvider";
import { t } from "../i18n/strings";

interface Tab {
  to: string;
  label: string;
  icon: string;
}

const TABS: Record<string, Tab[]> = {
  pic: [
    { to: "/", label: t.navRequest, icon: "📝" },
    { to: "/prices", label: t.navPrices, icon: "💰" },
  ],
  driver: [{ to: "/", label: t.navDeliveries, icon: "🚚" }],
  manager: [
    { to: "/", label: t.navOrders, icon: "📋" },
    { to: "/vendor-orders", label: "WhatsApp", icon: "🛒" },
    { to: "/purchase", label: t.navPurchase, icon: "💰" },
    { to: "/deliveries", label: t.navDeliveries, icon: "🚚" },
    { to: "/admin", label: t.navAdmin, icon: "⚙️" },
  ],
  superadmin: [
    { to: "/", label: t.navOrders, icon: "📋" },
    { to: "/vendor-orders", label: "WhatsApp", icon: "🛒" },
    { to: "/purchase", label: t.navPurchase, icon: "💰" },
    { to: "/deliveries", label: t.navDeliveries, icon: "🚚" },
    { to: "/admin", label: t.navAdmin, icon: "⚙️" },
  ],
};

export function BottomNav() {
  const { profile } = useAuth();
  const tabs = profile ? TABS[profile.role] : [];
  if (!tabs || tabs.length <= 1) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-lg">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === "/"}
            className={({ isActive }) =>
              `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                isActive ? "text-brand-700" : "text-gray-400"
              }`
            }
          >
            <span className="text-xl leading-none">{tab.icon}</span>
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
