import { findInvite } from "@/lib/customer-auth";
import { ActionForm, Submit } from "@/components/forms";
import { portalActivate } from "../../actions";

export const metadata = { title: "Criar senha" };

export default async function Activate({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await findInvite(token);
  if (!inv) return <div className="card card-pad mx-auto mt-6 max-w-sm text-center"><h1 className="font-semibold">Link inválido ou expirado</h1><p className="mt-2 text-sm text-muted">Peça um novo link à recepção da OneSportCar.</p></div>;
  return (
    <div className="mx-auto max-w-sm pt-6">
      <h1 className="text-xl font-semibold">Olá, {inv.customer.name.split(" ")[0]}!</h1>
      <p className="mt-1 text-sm text-muted">Crie sua senha. Depois, entre com seu CPF/CNPJ e essa senha.</p>
      <ActionForm action={portalActivate} className="card card-pad mt-5 space-y-3">
        <input type="hidden" name="token" value={token} />
        <label className="block"><span className="label">Nova senha (mín. 8 caracteres)</span><input name="password" type="password" minLength={8} className="input" autoComplete="new-password" required /></label>
        <label className="block"><span className="label">Repita a senha</span><input name="password2" type="password" minLength={8} className="input" autoComplete="new-password" required /></label>
        <Submit className="btn btn-primary w-full">Criar senha e entrar</Submit>
      </ActionForm>
    </div>
  );
}
