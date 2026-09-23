import type { Supplier } from "@prisma/client";
import { ActionForm, Submit } from "@/components/forms";
import { Field } from "@/components/ui";
import { CepInput } from "@/components/cep-input";
import { formatDocument } from "@/lib/validators";
import { saveSupplier } from "./actions";

export function SupplierForm({ s }: { s?: Supplier }) {
  return (
    <ActionForm action={saveSupplier} className="space-y-4">
      {s && <input type="hidden" name="id" value={s.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Tipo"><select name="type" className="select" defaultValue={s?.type ?? "PJ"}><option value="PJ">Pessoa jurídica</option><option value="PF">Pessoa física</option></select></Field>
        <Field label="CNPJ / CPF *" hint="CNPJ alfanumérico aceito"><input name="document" className="input" required defaultValue={s ? formatDocument(s.document) : ""} /></Field>
        <Field label="Razão social *" className="sm:col-span-2"><input name="name" className="input" required defaultValue={s?.name} /></Field>
        <Field label="Nome fantasia"><input name="tradeName" className="input" defaultValue={s?.tradeName ?? ""} /></Field>
        <Field label="Inscrição estadual"><input name="ie" className="input" defaultValue={s?.ie ?? ""} /></Field>
        <Field label="Contato"><input name="contactName" className="input" defaultValue={s?.contactName ?? ""} /></Field>
        <Field label="E-mail"><input name="email" type="email" className="input" defaultValue={s?.email ?? ""} /></Field>
        <Field label="Telefone"><input name="phone" className="input" defaultValue={s?.phone ?? ""} /></Field>
        <Field label="WhatsApp"><input name="whatsapp" className="input" defaultValue={s?.whatsapp ?? ""} /></Field>
        <Field label="Condição de pagamento" hint="Dias: 30 ou 30/60/90; 0 = à vista"><input name="paymentTerms" className="input" defaultValue={s?.paymentTerms ?? "30"} /></Field>
        <Field label="Prazo de entrega (dias)"><input name="leadTimeDays" className="input" inputMode="numeric" defaultValue={s?.leadTimeDays ?? ""} /></Field>
        <Field label="Especialidades"><input name="specialties" className="input" defaultValue={s?.specialties ?? ""} placeholder="Freios, filtros, pneus…" /></Field>
        <Field label="Marcas atendidas"><input name="brands" className="input" defaultValue={s?.brands ?? ""} /></Field>
        <Field label="Avaliação (1–5)"><input name="rating" type="number" min={1} max={5} className="input" defaultValue={s?.rating ?? ""} /></Field>
        <Field label="CEP"><CepInput defaultValue={s?.cep ?? ""} /></Field>
        <Field label="Logradouro" className="sm:col-span-2"><input name="street" className="input" defaultValue={s?.street ?? ""} /></Field>
        <Field label="Número"><input name="number" className="input" defaultValue={s?.number ?? ""} /></Field>
        <Field label="Bairro"><input name="district" className="input" defaultValue={s?.district ?? ""} /></Field>
        <Field label="Cidade"><input name="city" className="input" defaultValue={s?.city ?? ""} /></Field>
        <Field label="UF"><input name="uf" className="input" maxLength={2} defaultValue={s?.uf ?? ""} /></Field>
      </div>
      <Field label="Observações"><textarea name="notes" className="textarea" defaultValue={s?.notes ?? ""} /></Field>
      {s && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={s.active} /> Fornecedor ativo</label>}
      <Submit>{s ? "Salvar" : "Cadastrar fornecedor"}</Submit>
    </ActionForm>
  );
}
