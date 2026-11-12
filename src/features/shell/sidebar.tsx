"use client";

import { LayoutDashboardIcon, SettingsIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Wordmark } from "@/components/shared/wordmark";
import { UserMenu } from "@/features/shell/user-menu";
import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Wordmark href="/dashboard" />
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-1 px-2 py-2">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
                active && "bg-sidebar-accent text-foreground",
              )}
            >
              <Icon aria-hidden="true" className={cn("size-4", active && "text-primary")} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-2">
        <UserMenu onNavigate={onNavigate} />
      </div>
    </div>
  );
}
