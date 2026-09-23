"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, CalendarDays, Users, Car, Columns3, ClipboardList, Package, Wrench, ShieldCheck, UserCog, Menu, X, Moon, Sun, LogOut, Search,
} from "lucide-react";

const ICONS = { LayoutDashboard, CalendarDays, Users, Car, Columns3, ClipboardList, Package, Wrench, ShieldCheck, UserCog };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; group?: string };

export function Shell({ nav, user, logout, children }: { nav: NavItem[]; user: { name: string; role: string }; logout: () => Promise<void>; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="Menu principal">
      <Link href="/" className="mb-4 flex items-center gap-2 px-2 pt-1">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-accent text-sm font-black text-[var(--accent-contrast)]">1S</span>
        <span className="leading-tight">
          <span className="block text-sm font-bold tracking-wide">OneSportcar</span>
          <span className="block text-[10px] uppercase tracking-[.18em] text-muted">Workshop</span>
        </span>
      </Link>
      {nav.map((item, i) => {
        const Icon = ICONS[item.icon];
        const showGroup = item.group && item.group !== nav[i - 1]?.group;
        return (
          <div key={item.href}>
            {showGroup && <div className="mt-3 mb-1 px-2 text-[10px] font-semibold uppercase tracking-[.16em] text-muted">{item.group}</div>}
            <Link
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${isActive(item.href) ? "bg-accent-soft text-accent" : "text-fg/80 hover:bg-surface-2"}`}
            >
              <Icon size={17} strokeWidth={1.9} />
              {item.label}
            </Link>
          </div>
        );
      })}
      <div className="mt-auto border-t border-line pt-3">
        <div className="px-2 text-sm font-medium">{user.name}</div>
        <div className="px-2 text-xs text-muted">{user.role}</div>
        <div className="mt-2 flex gap-1">
          <ThemeToggle />
          <form action={logout}>
            <button className="btn btn-ghost btn-sm" title="Sair"><LogOut size={15} /> Sair</button>
          </form>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      <aside className="no-print sticky top-0 hidden h-dvh border-r border-line bg-surface md:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-line bg-surface">{sidebar}</aside>
        </div>
      )}
      <div className="min-w-0">
        <header className="no-print sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur md:px-6">
          <button className="btn btn-ghost btn-sm md:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu"><Menu size={18} /></button>
          <form action="/busca" className="relative flex-1 md:max-w-md">
            <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input name="q" className="input !min-h-9 !pl-9" placeholder="Buscar placa, cliente, CPF/CNPJ, OS, peça…" aria-label="Busca global" />
          </form>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-5 md:px-6 md:py-6">{children}</main>
      </div>
      {open && <button className="sr-only" onClick={() => setOpen(false)}><X /></button>}
    </div>
  );
}

export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setDark(t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  return (
    <button
      className="btn btn-ghost btn-sm"
      title="Alternar tema"
      onClick={() => {
        const next = dark ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem("osc-theme", next); } catch {}
        setDark(!dark);
      }}
    >
      {dark ? <Sun size={15} /> : <Moon size={15} />} Tema
    </button>
  );
}
