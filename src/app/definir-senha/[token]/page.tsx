import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requestMeta } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import { consumeToken, findValidToken } from "@/lib/password";
import { ActionForm, Submit } from "@/components/forms";

export const metadata = { title: "Definir senha", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

async function setPassword(_: ActionState, fd: FormData): Promise<ActionState> {
  "use server";
  let ok = false;
  const r = await run(async () => {
    const password = String(fd.get("password") ?? "");
    if (password !== String(fd.get("confirm") ?? "")) throw new RuleError("As senhas não conferem.");
    const user = await db.$transaction(async (tx) => {
      const u = await consumeToken(tx, String(fd.get("token")), password);
      await audit({ action: "PASSWORD_SET", entity: "User", entityId: u.id, userId: u.id, userName: u.name, ...(await requestMeta()) }, tx);
      return u;
    });
    ok = !!user;
  });
  if (ok) redirect("/login?senha=ok");
  return r;
}

export default async function SetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await findValidToken(db, token);
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-lg bg-accent text-lg font-black text-[var(--accent-contrast)]">1S</div>
          <h1 className="text-xl font-semibold">{t?.purpose === "PRIMEIRO_ACESSO" ? "Primeiro acesso" : "Definir nova senha"}</h1>
          {t && <p className="text-sm text-muted">{t.user.name} · {t.user.email}</p>}
        </div>
        {t ? (
          <ActionForm action={setPassword} className="card card-pad space-y-4">
            <input type="hidden" name="token" value={token} />
            <label className="block"><span className="label">Nova senha</span><input className="input" name="password" type="password" autoComplete="new-password" minLength={10} required /></label>
            <label className="block"><span className="label">Repita a senha</span><input className="input" name="confirm" type="password" autoComplete="new-password" minLength={10} required /></label>
            <p className="text-xs text-muted">Mínimo de 10 caracteres, com letras e números. Este link vale uma única vez.</p>
            <Submit className="btn btn-primary w-full">Salvar senha</Submit>
          </ActionForm>
        ) : (
          <p className="card card-pad text-center text-sm">Este link é inválido, já foi usado ou expirou. Peça um novo ao administrador do sistema.</p>
        )}
      </div>
    </main>
  );
}
