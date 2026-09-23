import type { PurchaseStatus, TitleStatus } from "@prisma/client";
import { PO_STATUS_LABEL } from "@/lib/purchasing";

const TITLE_TXT: Record<TitleStatus, string> = { ABERTO: "Em aberto", PARCIAL: "Parcial", PAGO: "Quitado", CANCELADO: "Cancelado" };

export function TitleBadge({ status, dueDate }: { status: TitleStatus; dueDate: Date }) {
  const overdue = (status === "ABERTO" || status === "PARCIAL") && dueDate < new Date(Date.now() - 86400_000);
  const cls = status === "PAGO" ? "badge badge-ok" : status === "CANCELADO" ? "badge" : overdue ? "badge badge-danger" : status === "PARCIAL" ? "badge badge-warn" : "badge badge-info";
  return <span className={cls}>{overdue ? "Vencido" : TITLE_TXT[status]}</span>;
}

const PO_TONE: Record<PurchaseStatus, string> = {
  RASCUNHO: "badge", AGUARDANDO_APROVACAO: "badge badge-warn", APROVADO: "badge badge-info", ENVIADO: "badge badge-accent",
  RECEBIDO_PARCIAL: "badge badge-warn", RECEBIDO: "badge badge-ok", CANCELADO: "badge badge-danger",
};
export function POBadge({ status }: { status: PurchaseStatus }) {
  return <span className={PO_TONE[status]}>{PO_STATUS_LABEL[status]}</span>;
}
