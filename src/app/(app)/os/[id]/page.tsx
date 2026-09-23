import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { allowedManualTargets, STATUS_LABEL } from "@/lib/workflow";
import { woTotals } from "@/lib/wo";
import { PageHeader, StatusBadge, Plate } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { moveWorkOrder } from "../actions";
import { loadWorkOrder } from "./data";
import { TabResumo } from "./tab-resumo";
import { TabDiagnostico } from "./tab-diagnostico";
import { TabOrcamento } from "./tab-orcamento";
import { TabExecucao } from "./tab-execucao";
import { TabQualidade } from "./tab-qualidade";
import { TabEntrega } from "./tab-entrega";
import { TabHistorico } from "./tab-historico";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const wo = await db.workOrder.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: wo?.number ?? "OS" };
}

export default async function WorkOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser("os:ver");
  const { id } = await params;
  const { tab = "resumo" } = await searchParams;
  const wo = await loadWorkOrder(id);
  if (!wo) notFound();
  if (!can(user.role, "os:ver_todas") && wo.technicianId !== user.id) redirect("/sem-permissao");

  const staff = await db.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true, hourlyCost: true } });
  const names = new Map(staff.map((u) => [u.id, u.name]));
  const techCost = new Map(staff.map((u) => [u.id, u.hourlyCost ?? 0]));
  const totals = woTotals({ ...wo, techCost });
  const money = can(user.role, "orcamento:editar") || can(user.role, "financeiro:ver_valores") || can(user.role, "pagamentos:registrar");

  const tabs = [
    ["resumo", "Resumo", true],
    ["diagnostico", "Inspeção e diagnóstico", true],
    ["orcamento", "Orçamentos", money || can(user.role, "orcamento:registrar_aprovacao")],
    ["execucao", "Execução", true],
    ["qualidade", "Qualidade", true],
    ["entrega", "Pagamento e entrega", money || can(user.role, "os:checkout")],
    ["historico", "Histórico", true],
  ] as const;
  const current = tabs.find(([k, , ok]) => k === tab && ok)?.[0] ?? "resumo";
  const manual = allowedManualTargets(wo.status).filter((s) => s !== "CANCELADA");
  const canCancel = allowedManualTargets(wo.status).includes("CANCELADA") && can(user.role, "os:cancelar");
  const props = { wo, user, names, totals, showMoney: money };

  return (
    <>
      <PageHeader
        back={<Link href="/os" className="link text-xs">← Ordens de serviço</Link>}
        title={<span className="flex flex-wrap items-center gap-3">{wo.number} <StatusBadge status={wo.status} />{wo.priority !== "NORMAL" && <span className="badge badge-warn">{wo.priority}</span>}</span>}
        subtitle={<>{wo.vehicle.make} {wo.vehicle.model} {wo.vehicle.version} <Plate plate={wo.vehicle.plate} /> · <Link className="link" href={`/clientes/${wo.customerId}`}>{wo.customer.name}</Link> · previsão {dateTime(wo.promisedAt)}</>}
        actions={can(user.role, "os:transicionar") && (
          <>
            {manual.map((to) => (
              <ActionForm key={to} action={moveWorkOrder}>
                <input type="hidden" name="id" value={wo.id} /><input type="hidden" name="to" value={to} />
                <Submit className="btn">→ {STATUS_LABEL[to]}</Submit>
              </ActionForm>
            ))}
            <a href={`/os/${wo.id}/imprimir`} target="_blank" className="btn">Imprimir OS</a>
            {canCancel && (
              <details className="relative">
                <summary className="btn btn-danger list-none">Cancelar OS</summary>
                <div className="card absolute right-0 z-20 mt-1 w-72 p-3">
                  <ActionForm action={moveWorkOrder} confirm="Cancelar esta OS? A ação não pode ser desfeita.">
                    <input type="hidden" name="id" value={wo.id} /><input type="hidden" name="to" value="CANCELADA" />
                    <textarea name="reason" className="textarea" placeholder="Motivo do cancelamento" required />
                    <Submit className="btn btn-danger mt-2 w-full">Confirmar cancelamento</Submit>
                  </ActionForm>
                </div>
              </details>
            )}
          </>
        )}
      />
      <nav className="no-print -mx-4 mb-5 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0" aria-label="Seções da OS">
        <ul className="flex gap-1">
          {tabs.filter(([, , ok]) => ok).map(([k, label]) => (
            <li key={k}>
              <Link href={`?tab=${k}`} className={`block border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${current === k ? "border-accent text-accent" : "border-transparent text-muted hover:text-fg"}`}>{label}</Link>
            </li>
          ))}
        </ul>
      </nav>
      {current === "resumo" && <TabResumo {...props} />}
      {current === "diagnostico" && <TabDiagnostico {...props} />}
      {current === "orcamento" && <TabOrcamento {...props} />}
      {current === "execucao" && <TabExecucao {...props} />}
      {current === "qualidade" && <TabQualidade {...props} />}
      {current === "entrega" && <TabEntrega {...props} />}
      {current === "historico" && <TabHistorico {...props} />}
    </>
  );
}
