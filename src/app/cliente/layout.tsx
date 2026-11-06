import Link from "next/link";
import { getCustomer } from "@/lib/customer-auth";
import { portalLogout } from "./actions";

export const metadata = { title: { default: "Meu OneSportCar", template: "%s · Meu OneSportCar" }, manifest: "/cliente/manifest.webmanifest", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const c = await getCustomer();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2.5">
          <Link href="/cliente" className="flex items-center gap-2">
            <span className="grid h-9 place-items-center rounded-md bg-[#0c0d0f] px-2.5"><img src="/logo-one.svg" alt="OneSportCar" className="h-4" /></span>
            <span className="text-sm font-bold">Meu OneSportCar</span>
          </Link>
          {c && (
            <nav className="ml-auto flex items-center gap-1 text-sm">
              <Link href="/cliente" className="btn btn-ghost btn-sm">Início</Link>
              <Link href="/cliente/agendar" className="btn btn-primary btn-sm">Agendar</Link>
              <form action={portalLogout}><button className="btn btn-ghost btn-sm">Sair</button></form>
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>
    </div>
  );
}
