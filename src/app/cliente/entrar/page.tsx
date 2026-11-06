import { redirect } from "next/navigation";
import { getCustomer } from "@/lib/customer-auth";
import { ActionForm, Submit } from "@/components/forms";
import { portalLogin } from "../actions";

export const metadata = { title: "Entrar" };

export default async function PortalLogin() {
  if (await getCustomer()) redirect("/cliente");
  return (
    <div className="mx-auto max-w-sm pt-6">
      <h1 className="text-xl font-semibold">Acompanhe seu carro</h1>
      <p className="mt-1 text-sm text-muted">Agende serviços, veja o check-in com fotos, aprove orçamentos e assista à manutenção pelas nossas câmeras.</p>
      <ActionForm action={portalLogin} className="card card-pad mt-5 space-y-3">
        <label className="block"><span className="label">CPF ou CNPJ</span><input name="document" className="input" inputMode="numeric" autoComplete="username" required /></label>
        <label className="block"><span className="label">Senha</span><input name="password" type="password" className="input" autoComplete="current-password" required /></label>
        <Submit className="btn btn-primary w-full">Entrar</Submit>
      </ActionForm>
      <p className="mt-4 text-center text-xs text-muted">Primeiro acesso ou esqueceu a senha? Peça o link de acesso à recepção da OneSportCar.</p>
    </div>
  );
}
