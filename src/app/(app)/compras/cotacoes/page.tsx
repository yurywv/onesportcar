import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { PageHeader, Plate, Empty, Section } from "@/components/ui";
import { QuoteForm } from "@/components/quote-form";

export const metadata = { title: "Cotações" };
export const dynamic = "force-dynamic";

// Fila do comprador: peças levantadas pelo mecânico que precisam de custo, fornecedor e prazo.
// O comprador vê só as peças e a observação técnica — não o diagnóstico completo.
export default async function Quotes() {
  await requireUser("cotacao:editar");
  const rows = await db.workOrder.findMany({
    where: { status: "ORCAMENTO", quoteStatus: "PENDENTE" },
    include: { vehicle: true, diagnosticItems: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ priority: "desc" }, { updatedAt: "asc" }],
  });
  return (
    <>
      <PageHeader title="Cotações de peças" subtitle={`${rows.length} OS aguardando cotação. Ao concluir, a OS vai para o comercial precificar.`} />
      {rows.length ? (
        <div className="space-y-5">
          {rows.map((wo) => (
            <Section key={wo.id} title={`${wo.number} · ${wo.vehicle.make} ${wo.vehicle.model}`} actions={<span className="flex items-center gap-2 text-xs"><Plate plate={wo.vehicle.plate} />{wo.priority !== "NORMAL" && <span className="badge badge-warn">{wo.priority}</span>}<Link className="link" href={`/os/${wo.id}?tab=precificacao`}>abrir OS</Link></span>}>
              <p className="mb-2 text-xs text-muted">{wo.vehicle.version} {wo.vehicle.yearModel} · VIN {wo.vehicle.vin ?? "—"} · desde {dateTime(wo.updatedAt)}</p>
              <QuoteForm workOrderId={wo.id} items={wo.diagnosticItems} />
            </Section>
          ))}
        </div>
      ) : <Empty>Nenhuma cotação pendente.</Empty>}
    </>
  );
}
