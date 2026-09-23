import type { Customer } from "@prisma/client";
import { ActionForm, Submit } from "@/components/forms";
import { Field } from "@/components/ui";
import { CepInput } from "@/components/cep-input";
import { formatDocument } from "@/lib/validators";
import type { ActionState } from "@/lib/action";

export function CustomerForm({ action, customer }: { action: (s: ActionState, fd: FormData) => Promise<ActionState>; customer?: Customer }) {
  const c = customer;
  return (
    <ActionForm action={action} className="space-y-5">
      {c && <input type="hidden" name="id" value={c.id} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Tipo">
          <select name="type" className="select" defaultValue={c?.type ?? "PF"}>
            <option value="PF">Pessoa física</option>
            <option value="PJ">Pessoa jurídica</option>
          </select>
        </Field>
        <Field label="CPF / CNPJ *" hint="CNPJ alfanumérico aceito">
          <input name="document" className="input" required defaultValue={c ? formatDocument(c.document) : ""} />
        </Field>
        <Field label="Nome / Razão social *" className="sm:col-span-2">
          <input name="name" className="input" required defaultValue={c?.name} />
        </Field>
        <Field label="Nome fantasia"><input name="tradeName" className="input" defaultValue={c?.tradeName ?? ""} /></Field>
        <Field label="RG / IE"><input name="rgIe" className="input" defaultValue={c?.rgIe ?? ""} /></Field>
        <Field label="Nascimento"><input name="birthDate" type="date" className="input" defaultValue={c?.birthDate?.toISOString().slice(0, 10) ?? ""} /></Field>
        <Field label="Origem">
          <input name="origin" className="input" list="origins" defaultValue={c?.origin ?? ""} />
          <datalist id="origins">{["Indicação", "Instagram", "Google", "Concessionária", "Evento", "Site"].map((o) => <option key={o} value={o} />)}</datalist>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Telefone"><input name="phone" className="input" inputMode="tel" defaultValue={c?.phone ?? ""} /></Field>
        <Field label="WhatsApp"><input name="whatsapp" className="input" inputMode="tel" defaultValue={c?.whatsapp ?? ""} /></Field>
        <Field label="E-mail"><input name="email" type="email" className="input" defaultValue={c?.email ?? ""} /></Field>
        <Field label="Canal preferido">
          <select name="preferredChannel" className="select" defaultValue={c?.preferredChannel ?? "WHATSAPP"}>
            <option value="WHATSAPP">WhatsApp</option><option value="EMAIL">E-mail</option><option value="TELEFONE">Telefone</option>
          </select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <Field label="CEP"><CepInput defaultValue={c?.cep ?? ""} /></Field>
        <Field label="Logradouro" className="lg:col-span-3"><input name="street" className="input" defaultValue={c?.street ?? ""} /></Field>
        <Field label="Número"><input name="number" className="input" defaultValue={c?.number ?? ""} /></Field>
        <Field label="Complemento"><input name="complement" className="input" defaultValue={c?.complement ?? ""} /></Field>
        <Field label="Bairro" className="lg:col-span-2"><input name="district" className="input" defaultValue={c?.district ?? ""} /></Field>
        <Field label="Cidade" className="lg:col-span-3"><input name="city" className="input" defaultValue={c?.city ?? ""} /></Field>
        <Field label="UF"><input name="uf" className="input" maxLength={2} defaultValue={c?.uf ?? ""} /></Field>
      </div>
      <Field label="Observações"><textarea name="notes" className="textarea" defaultValue={c?.notes ?? ""} /></Field>
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="consentMarketing" defaultChecked={c?.consentMarketing} /> Cliente consente receber comunicações de relacionamento e pós-venda (LGPD)</label>
        {c ? (
          <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={c.active} /> Cadastro ativo</label>
        ) : (
          <label className="flex items-center gap-2 text-muted"><input type="checkbox" name="confirmDuplicate" value="1" /> Confirmo que não é duplicado (se o sistema alertar)</label>
        )}
      </div>
      <Submit>{c ? "Salvar alterações" : "Cadastrar cliente"}</Submit>
    </ActionForm>
  );
}
