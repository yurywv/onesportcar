import { redirect } from "next/navigation";
import { getUser, login } from "@/lib/auth";
import { run, type ActionState } from "@/lib/action";
import { ActionForm, Submit } from "@/components/forms";

export const metadata = { title: "Entrar" };

async function doLogin(_: ActionState, fd: FormData): Promise<ActionState> {
  "use server";
  let ok = false;
  const r = await run(async () => {
    const res = await login(String(fd.get("email") ?? ""), String(fd.get("password") ?? ""));
    if (!res.ok) throw new (await import("@/lib/workflow")).RuleError(res.error);
    ok = true;
  });
  if (ok) redirect("/");
  return r;
}

export default async function LoginPage() {
  if (await getUser()) redirect("/");
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-lg bg-accent text-lg font-black text-[var(--accent-contrast)]">1S</div>
          <h1 className="text-2xl font-semibold tracking-tight">OneSportcar</h1>
          <p className="text-sm text-muted">Gestão de oficina · DBL Automotiva</p>
        </div>
        <ActionForm action={doLogin} className="card card-pad space-y-4">
          <label className="block">
            <span className="label">E-mail</span>
            <input className="input" name="email" type="email" autoComplete="username" required />
          </label>
          <label className="block">
            <span className="label">Senha</span>
            <input className="input" name="password" type="password" autoComplete="current-password" required />
          </label>
          <Submit className="btn btn-primary w-full">Entrar</Submit>
        </ActionForm>
        <p className="mt-6 text-center text-xs text-muted">Acesso restrito a colaboradores autorizados. Todas as ações são registradas.</p>
      </div>
    </main>
  );
}
