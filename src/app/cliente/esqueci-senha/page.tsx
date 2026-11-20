import Link from "next/link";
import { requestMeta } from "@/lib/auth";
import { baseUrl } from "@/lib/base-url";
import { run, req, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import { requestCustomerReset, RESET_MINUTES } from "@/lib/password-reset";
import { ActionForm, Submit } from "@/components/forms";

export const metadata = { title: "Esqueci minha senha" };

async function forgot(_: ActionState, fd: FormData): Promise<ActionState> {
  "use server";
  return run(async () => {
    const doc = req(fd, "document", "CPF ou CNPJ");
    const r = await requestCustomerReset(doc, await baseUrl(), await requestMeta());
    if (r.sent === false && r.reason === "limite") throw new RuleError("Muitos pedidos em pouco tempo. Aguarde 15 minutos e tente de novo.");
    if (r.sent === false && r.reason === "falha_envio") throw new RuleError("Não foi possível enviar o e-mail agora. Fale com a recepção da One Sportcar.");
    return `Se o CPF/CNPJ tiver e-mail cadastrado, enviamos um link para criar nova senha (vale ${RESET_MINUTES} minutos). Sem e-mail cadastrado? Fale com a recepção.`;
  });
}

export default function CustomerForgot() {
  return (
    <div className="mx-auto max-w-sm pt-6">
      <h1 className="text-xl font-semibold">Esqueci minha senha</h1>
      <p className="mt-1 text-sm text-muted">Enviaremos um link para o e-mail cadastrado na One Sportcar. Ele vale por {RESET_MINUTES} minutos.</p>
      <ActionForm action={forgot} className="card card-pad mt-5 space-y-3" reset>
        <label className="block"><span className="label">CPF ou CNPJ</span><input name="document" className="input" inputMode="numeric" autoComplete="username" required /></label>
        <Submit className="btn btn-primary w-full">Enviar link</Submit>
      </ActionForm>
      <p className="mt-4 text-center text-sm"><Link href="/cliente/entrar" className="link">Voltar</Link></p>
    </div>
  );
}
