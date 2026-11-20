import Link from "next/link";
import { requestMeta } from "@/lib/auth";
import { baseUrl } from "@/lib/base-url";
import { run, req, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import { isValidEmail } from "@/lib/validators";
import { requestStaffReset, RESET_MINUTES } from "@/lib/password-reset";
import { ActionForm, Submit } from "@/components/forms";

export const metadata = { title: "Esqueci minha senha", robots: { index: false } };

async function forgot(_: ActionState, fd: FormData): Promise<ActionState> {
  "use server";
  return run(async () => {
    const email = req(fd, "email", "E-mail");
    if (!isValidEmail(email)) throw new RuleError("Informe um e-mail válido.");
    const r = await requestStaffReset(email, await baseUrl(), await requestMeta());
    if (r.sent === false && r.reason === "limite") throw new RuleError("Muitos pedidos em pouco tempo. Aguarde 15 minutos e tente de novo.");
    if (r.sent === false && r.reason === "falha_envio") throw new RuleError("Não foi possível enviar o e-mail agora. Tente mais tarde ou peça ao administrador um link de redefinição.");
    return `Se ${email} estiver cadastrado, enviamos um link para criar uma nova senha. Ele vale por ${RESET_MINUTES} minutos. Confira também a caixa de spam.`;
  });
}

export default function ForgotPassword() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Esqueci minha senha</h1>
          <p className="mt-1 text-sm text-muted">Informe o e-mail do seu acesso. Enviaremos um link que vale por {RESET_MINUTES} minutos.</p>
        </div>
        <ActionForm action={forgot} className="card card-pad space-y-4" reset>
          <label className="block"><span className="label">E-mail</span><input className="input" name="email" type="email" autoComplete="username" required /></label>
          <Submit className="btn btn-primary w-full">Enviar link</Submit>
        </ActionForm>
        <p className="mt-4 text-center text-sm"><Link href="/login" className="link">Voltar para o login</Link></p>
      </div>
    </main>
  );
}
