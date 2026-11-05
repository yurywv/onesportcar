"use server";
import { revalidatePath } from "next/cache";
import type { ServicePhase } from "@prisma/client";
import { db } from "@/lib/db";
import { assertUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { run, str, req, int, num, bool, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import { parseMoney } from "@/lib/format";
import { nextNumber } from "@/lib/sequence";
import { PHASES } from "@/lib/phases";
import { createPortalInvite } from "@/lib/customer-auth";
import { quotePending, priceFor, parseDiagItems } from "@/lib/quote";
import { headers } from "next/headers";

const refresh = (id: string) => { revalidatePath(`/os/${id}`); revalidatePath(`/cliente/os/${id}`); revalidatePath("/compras/cotacoes"); revalidatePath("/comercial"); revalidatePath("/recepcao"); };
const asPhase = (v: unknown): ServicePhase => { if (!PHASES.includes(v as ServicePhase)) throw new RuleError("Fase inválida."); return v as ServicePhase; };

// ───────────── Fotos ─────────────

export async function addPhoto(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("fotos:adicionar");
    const woId = req(fd, "workOrderId", "OS");
    const wo = await db.workOrder.findUniqueOrThrow({ where: { id: woId } });
    if (["CANCELADA"].includes(wo.status)) throw new RuleError("OS cancelada.");
    const data = String(fd.get("data") ?? "");
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(data);
    if (!m) throw new RuleError("Imagem inválida.");
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 3_000_000) throw new RuleError("Imagem muito grande (máx. 3 MB).");
    const phase = asPhase(fd.get("phase"));
    // Fotos do diagnóstico ficam internas por padrão (não entregar o caminho da solução).
    const visible = bool(fd, "visible") && !(user.role === "TECNICO" && phase === "DIAGNOSTICO");
    const p = await db.workOrderPhoto.create({ data: { workOrderId: woId, phase, caption: str(fd, "caption")?.slice(0, 120), mime: m[1], bytes: buf.length, data: buf, visibleToCustomer: visible, createdById: user.id, createdByName: user.name } });
    await audit({ action: "CREATE", entity: "WorkOrderPhoto", entityId: p.id, userId: user.id, userName: user.name, after: { workOrderId: woId, phase, visible } });
    refresh(woId);
    return "Foto enviada.";
  });
}

export async function togglePhoto(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("fotos:adicionar");
    const p = await db.workOrderPhoto.findUniqueOrThrow({ where: { id: String(fd.get("id")) } });
    await db.workOrderPhoto.update({ where: { id: p.id }, data: { visibleToCustomer: !p.visibleToCustomer } });
    await audit({ action: "UPDATE", entity: "WorkOrderPhoto", entityId: p.id, userId: user.id, userName: user.name, after: { visibleToCustomer: !p.visibleToCustomer } });
    refresh(p.workOrderId);
    return p.visibleToCustomer ? "Foto ocultada do cliente." : "Foto liberada para o cliente.";
  });
}

// ───────────── Itens do diagnóstico (mecânico) ─────────────

export async function addDiagnosticItems(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("os:diagnosticar");
    const woId = req(fd, "workOrderId", "OS");
    const wo = await db.workOrder.findUniqueOrThrow({ where: { id: woId } });
    if (!["EM_DIAGNOSTICO", "ORCAMENTO", "AGUARDANDO_DIAGNOSTICO"].includes(wo.status)) throw new RuleError("Itens do diagnóstico só podem ser lançados até o orçamento.");
    const items = parseDiagItems(str(fd, "items"));
    if (!items.length) throw new RuleError("Adicione ao menos um item.");
    await db.$transaction(async (tx) => {
      const last = await tx.diagnosticItem.count({ where: { workOrderId: woId } });
      await tx.diagnosticItem.createMany({ data: items.map((it, i) => ({ ...it, workOrderId: woId, createdById: user.id, sortOrder: last + i })) });
      if (wo.status === "ORCAMENTO" && items.some((i) => i.type !== "SERVICO")) await tx.workOrder.update({ where: { id: woId }, data: { quoteStatus: "PENDENTE", quoteDoneAt: null, quoteDoneBy: null } });
    });
    refresh(woId);
    return `${items.length} item(ns) adicionado(s).`;
  });
}

export async function removeDiagnosticItem(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser();
    const it = await db.diagnosticItem.findUniqueOrThrow({ where: { id: String(fd.get("id")) }, include: { workOrder: true } });
    if (!can(user.role, "os:diagnosticar") && !can(user.role, "precificacao:editar")) throw new RuleError("Sem permissão.");
    if (it.estimateItemId) throw new RuleError("Item já está no orçamento. Remova-o por lá.");
    if (!["EM_DIAGNOSTICO", "ORCAMENTO", "AGUARDANDO_DIAGNOSTICO"].includes(it.workOrder.status)) throw new RuleError("A OS já passou da etapa de orçamento.");
    await db.diagnosticItem.delete({ where: { id: it.id } });
    refresh(it.workOrderId);
    return "Item removido.";
  });
}

// ───────────── Cotação (comprador) ─────────────

export async function saveQuote(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("cotacao:editar");
    const woId = req(fd, "workOrderId", "OS");
    const wo = await db.workOrder.findUniqueOrThrow({ where: { id: woId }, include: { diagnosticItems: true } });
    if (wo.status !== "ORCAMENTO") throw new RuleError("A cotação é feita enquanto a OS está em orçamento.");
    const suppliers = new Map((await db.supplier.findMany({ where: { active: true }, select: { id: true, name: true, tradeName: true, leadTimeDays: true } })).map((s) => [s.id, s]));
    let changed = 0;
    await db.$transaction(async (tx) => {
      for (const it of wo.diagnosticItems.filter((i) => i.type !== "SERVICO")) {
        const costRaw = str(fd, `cost_${it.id}`);
        if (costRaw === null) continue;
        const unitCost = parseMoney(costRaw);
        if (!Number.isFinite(unitCost) || unitCost < 0) throw new RuleError(`Custo inválido em "${it.description}".`);
        const sup = suppliers.get(str(fd, `sup_${it.id}`) ?? "");
        await tx.diagnosticItem.update({
          where: { id: it.id },
          data: {
            unitCost, supplierId: sup?.id ?? null, supplierName: sup ? (sup.tradeName ?? sup.name) : str(fd, `supname_${it.id}`),
            leadTimeDays: int(fd, `lead_${it.id}`) ?? sup?.leadTimeDays ?? null, inventoryItemId: str(fd, `inv_${it.id}`),
            quoteNotes: str(fd, `qn_${it.id}`), quotedById: user.id, quotedByName: user.name, quotedAt: new Date(),
          },
        });
        changed++;
      }
      if (bool(fd, "finish")) {
        const left = await tx.diagnosticItem.count({ where: { workOrderId: woId, type: { not: "SERVICO" }, unitCost: null } });
        if (left) throw new RuleError(`Faltam ${left} item(ns) sem custo.`);
        await tx.workOrder.update({ where: { id: woId }, data: { quoteStatus: "CONCLUIDA", quoteDoneAt: new Date(), quoteDoneBy: user.name } });
      }
      await audit({ action: "QUOTE", entity: "WorkOrder", entityId: woId, userId: user.id, userName: user.name, after: { items: changed, finish: bool(fd, "finish") } }, tx);
    });
    refresh(woId);
    return bool(fd, "finish") ? "Cotação concluída — enviada ao comercial para precificação." : `Cotação salva (${changed} item(ns)).`;
  });
}

export async function reopenQuote(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser();
    if (!can(user.role, "cotacao:editar") && !can(user.role, "precificacao:editar")) throw new RuleError("Sem permissão.");
    const woId = req(fd, "workOrderId", "OS");
    await db.workOrder.update({ where: { id: woId }, data: { quoteStatus: "PENDENTE", quoteDoneAt: null, quoteDoneBy: null } });
    refresh(woId);
    return "Cotação reaberta para o comprador.";
  });
}

// ───────────── Precificação (comercial) ─────────────

export async function priceDiagnostic(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("precificacao:editar");
    if (!can(user.role, "orcamento:editar")) throw new RuleError("Sem permissão para montar orçamentos.");
    const woId = req(fd, "workOrderId", "OS");
    const wo = await db.workOrder.findUniqueOrThrow({ where: { id: woId }, include: { diagnosticItems: { orderBy: { sortOrder: "asc" } }, estimates: true } });
    if (wo.status !== "ORCAMENTO") throw new RuleError('A precificação é feita com a OS em "Orçamento".');
    if (quotePending(wo)) throw new RuleError("Aguarde o comprador concluir a cotação das peças.");
    const hourly = parseMoney(req(fd, "hourlyRate", "Valor da hora"));
    const defMargin = num(fd, "margin") ?? 0;
    if (hourly <= 0) throw new RuleError("Informe o valor da hora.");
    const todo = wo.diagnosticItems.filter((i) => !i.estimateItemId);
    if (!todo.length) throw new RuleError("Todos os itens já estão no orçamento.");
    const sent = wo.estimates.find((e) => e.status !== "RASCUNHO");
    if (sent) throw new RuleError("O orçamento inicial já foi enviado. Itens novos entram por orçamento complementar.");

    const estId = await db.$transaction(async (tx) => {
      const est = wo.estimates.find((e) => e.status === "RASCUNHO") ?? await tx.estimate.create({
        data: { number: await nextNumber(tx, wo.branchId, "ORC"), workOrderId: woId, kind: "INICIAL", createdById: user.id, validUntil: new Date(Date.now() + 7 * 86400_000) },
      });
      let order = await tx.estimateItem.count({ where: { estimateId: est.id } });
      for (const it of todo) {
        if (fd.get(`skip_${it.id}`) === "on") continue;
        const margin = num(fd, `mg_${it.id}`) ?? defMargin;
        const override = str(fd, `price_${it.id}`);
        const minutes = it.type === "SERVICO" ? (int(fd, `min_${it.id}`) ?? it.minutes ?? 60) : null;
        const { unitPrice, unitCost } = priceFor({ type: it.type, quantity: it.quantity, minutes, unitCost: it.unitCost }, { hourly, margin, override: override ? parseMoney(override) : null });
        const ei = await tx.estimateItem.create({
          data: {
            estimateId: est.id, type: it.type, classification: it.classification, description: str(fd, `desc_${it.id}`) ?? it.description,
            reference: it.reference, quantity: it.type === "SERVICO" ? 1 : it.quantity, minutes, unit: it.type === "SERVICO" ? "H" : "UN",
            unitPrice, unitCost, inventoryItemId: it.inventoryItemId, sortOrder: order++,
          },
        });
        await tx.diagnosticItem.update({ where: { id: it.id }, data: { estimateItemId: ei.id } });
      }
      if (str(fd, "notes")) await tx.estimate.update({ where: { id: est.id }, data: { notes: str(fd, "notes") } });
      await audit({ action: "PRICE", entity: "Estimate", entityId: est.id, userId: user.id, userName: user.name, after: { hourly, defMargin, items: todo.length } }, tx);
      return est.id;
    });
    refresh(woId);
    return { message: "Orçamento montado. Revise na aba Orçamentos e envie ao cliente.", data: { estimateId: estId } };
  });
}

// ───────────── Câmeras da OS ─────────────

export async function assignCamera(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("cameras:configurar");
    const woId = req(fd, "workOrderId", "OS");
    const phase = asPhase(fd.get("phase"));
    const cameraId = req(fd, "cameraId", "Câmera");
    await db.workOrderCamera.upsert({ where: { workOrderId_phase_cameraId: { workOrderId: woId, phase, cameraId } }, update: {}, create: { workOrderId: woId, phase, cameraId, createdById: user.id } });
    await audit({ action: "UPDATE", entity: "WorkOrderCamera", entityId: woId, userId: user.id, userName: user.name, after: { phase, cameraId } });
    refresh(woId);
    return "Câmera associada.";
  });
}

export async function unassignCamera(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("cameras:configurar");
    const a = await db.workOrderCamera.findUniqueOrThrow({ where: { id: String(fd.get("id")) } });
    await db.workOrderCamera.delete({ where: { id: a.id } });
    await audit({ action: "DELETE", entity: "WorkOrderCamera", entityId: a.workOrderId, userId: user.id, userName: user.name, before: { phase: a.phase, cameraId: a.cameraId } });
    refresh(a.workOrderId);
    return "Câmera removida desta fase.";
  });
}

// ───────────── Convite do app do cliente ─────────────

export async function inviteCustomer(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("app_cliente:convidar");
    const customerId = req(fd, "customerId", "Cliente");
    const c = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    const token = await db.$transaction(async (tx) => {
      const t = await createPortalInvite(tx, customerId, user.id);
      await audit({ action: "INVITE", entity: "CustomerPortal", entityId: customerId, userId: user.id, userName: user.name }, tx);
      return t;
    });
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
    const link = `${proto}://${host}/cliente/ativar/${token}`;
    revalidatePath(`/clientes/${customerId}`);
    return {
      message: `Link de acesso gerado para ${c.name.split(" ")[0]} (válido por 7 dias). Envie pelo WhatsApp.`,
      data: { link, share: `Olá, ${c.name.split(" ")[0]}! Acompanhe seu carro na OneSportCar: agendamentos, check-in com fotos, orçamentos e câmeras ao vivo. Crie sua senha neste link: ${link}` },
    };
  });
}
