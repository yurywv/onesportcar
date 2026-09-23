import type { Vehicle } from "@prisma/client";
import { ActionForm, Submit } from "@/components/forms";
import { Field } from "@/components/ui";
import { formatPlate } from "@/lib/validators";
import type { ActionState } from "@/lib/action";

const PROP = [["GASOLINA", "Gasolina"], ["FLEX", "Flex"], ["ETANOL", "Etanol"], ["DIESEL", "Diesel"], ["HIBRIDO", "Híbrido"], ["HIBRIDO_PLUGIN", "Híbrido plug-in"], ["ELETRICO", "Elétrico"]];
const MAKES = ["Porsche", "Ferrari", "Lamborghini", "McLaren", "Aston Martin", "Bentley", "Rolls-Royce", "Maserati", "Mercedes-Benz", "Mercedes-AMG", "BMW", "BMW M", "Audi", "Land Rover", "Volvo", "Lexus", "Jaguar"];

export function VehicleForm({ action, vehicle, customers, customerId }: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>; vehicle?: Vehicle; customers?: { id: string; name: string }[]; customerId?: string;
}) {
  const v = vehicle;
  return (
    <ActionForm action={action} className="space-y-5">
      {v && <input type="hidden" name="id" value={v.id} />}
      {customers && (
        <Field label="Proprietário *">
          <select name="customerId" className="select" required defaultValue={customerId ?? ""}>
            <option value="">Selecione…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Placa *" hint="Antiga ou Mercosul"><input name="plate" className="input font-mono uppercase" required defaultValue={v ? formatPlate(v.plate) : ""} /></Field>
        <Field label="Marca *">
          <input name="make" className="input" list="makes" required defaultValue={v?.make} />
          <datalist id="makes">{MAKES.map((m) => <option key={m} value={m} />)}</datalist>
        </Field>
        <Field label="Modelo *"><input name="model" className="input" required defaultValue={v?.model} /></Field>
        <Field label="Versão"><input name="version" className="input" defaultValue={v?.version ?? ""} /></Field>
        <Field label="Ano fabricação"><input name="yearMfg" className="input" inputMode="numeric" defaultValue={v?.yearMfg ?? ""} /></Field>
        <Field label="Ano modelo"><input name="yearModel" className="input" inputMode="numeric" defaultValue={v?.yearModel ?? ""} /></Field>
        <Field label="Cor"><input name="color" className="input" defaultValue={v?.color ?? ""} /></Field>
        <Field label="Propulsão">
          <select name="propulsion" className="select" defaultValue={v?.propulsion ?? "GASOLINA"}>{PROP.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label="Chassi (VIN)"><input name="vin" className="input font-mono uppercase" maxLength={17} defaultValue={v?.vin ?? ""} /></Field>
        <Field label="RENAVAM"><input name="renavam" className="input" inputMode="numeric" defaultValue={v?.renavam ?? ""} /></Field>
        <Field label="Motor"><input name="engine" className="input" defaultValue={v?.engine ?? ""} /></Field>
        <Field label="Potência"><input name="power" className="input" defaultValue={v?.power ?? ""} /></Field>
        <Field label="Transmissão"><input name="transmission" className="input" defaultValue={v?.transmission ?? ""} /></Field>
        <Field label="Tração"><input name="traction" className="input" defaultValue={v?.traction ?? ""} /></Field>
        {!v && <Field label="Quilometragem atual"><input name="mileage" className="input" inputMode="numeric" defaultValue="0" /></Field>}
      </div>
      <Field label="Observações"><textarea name="notes" className="textarea" defaultValue={v?.notes ?? ""} /></Field>
      <Submit>{v ? "Salvar alterações" : "Cadastrar veículo"}</Submit>
    </ActionForm>
  );
}
