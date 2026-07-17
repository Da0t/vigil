"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Siren,
  Waypoints,
  ShieldCheck,
  Cable,
  Settings,
  Moon,
  Sun,
  ScanEye,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/incidents", label: "Incidents", icon: Siren },
  { href: "/infrastructure", label: "Infrastructure", icon: Waypoints },
  { href: "/actions", label: "Actions", icon: ShieldCheck },
  { href: "/connectors", label: "Connectors", icon: Cable },
  { href: "/settings", label: "Settings", icon: Settings },
];

function Wordmark() {
  return (
    <Link href="/" className="group flex items-center gap-2.5">
      <span className="relative grid h-9 w-9 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/40">
        <ScanEye className="h-5 w-5 text-[hsl(var(--primary))]" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-[0.22em] text-foreground">
          VIGIL
        </span>
        <span className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          autonomous on-call
        </span>
      </span>
    </Link>
  );
}

function AgentPill() {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-secondary/40 px-3 py-2">
      <span className="h-6 w-[3px] rounded-full bg-[hsl(var(--primary))]" />
      <div className="flex flex-col leading-none">
        <span className="text-xs font-medium text-foreground">Agent active</span>
        <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          watching
        </span>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = !mounted || theme !== "light";
  return (
    <button
      aria-label="toggle theme"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="grid h-9 w-9 place-items-center rounded-xl border border-border/70 bg-secondary/30 text-muted-foreground transition-colors hover:text-foreground"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function NavItems({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {NAV.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all",
              active
                ? "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            )}
          >
            {active && (
              <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[hsl(var(--primary))]" />
            )}
            <Icon
              className={cn(
                "h-[18px] w-[18px] transition-colors",
                active
                  ? "text-[hsl(var(--primary))]"
                  : "text-muted-foreground group-hover:text-foreground"
              )}
            />
            <span className="font-medium">{label}</span>
          </Link>
        );
      })}
    </>
  );
}

export function Navigation() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop rail */}
      <aside className="sticky top-0 z-30 hidden h-screen w-64 shrink-0 flex-col gap-6 border-r border-border bg-background px-4 py-6 lg:flex">
        <Wordmark />
        <AgentPill />
        <nav className="flex flex-1 flex-col gap-1">
          <NavItems pathname={pathname} />
        </nav>
        <div className="flex items-center justify-between border-t border-border/60 pt-4">
          <span className="text-[11px] text-muted-foreground">
            0 standing credentials
          </span>
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex w-full items-center justify-between border-b border-border bg-background px-4 py-3 lg:hidden">
        <Wordmark />
        <div className="flex items-center gap-2">
          <AgentPill />
          <ThemeToggle />
        </div>
      </div>
      <nav className="sticky top-[65px] z-20 flex w-full items-center gap-1 overflow-x-auto border-b border-border bg-background px-3 py-2 lg:hidden">
        <NavItems pathname={pathname} />
      </nav>
    </>
  );
}
