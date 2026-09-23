"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { ItemClass, ItemType, WorkOrderStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { assertUser, requestMeta, type SessionUser } from "@/lib/auth";
import { can, discountLimit } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { sha256 } from "@/lib/hash";
import { run, str, req, int, num, bool, type ActionState } from "@/lib/action";
import { RuleError, transition, STATUS_LABEL } from "@/lib/workflow";
import { nextNumber } from "@/lib/sequence";
import { fromLocalInput, parseMoney, money } from "@/lib/format";
import { sendEstimate, recordDecisions, createApprovalLink, lineGross, type Snapshot } from "@/lib/estimate";
import { applyPart, returnPart } from "@/lib/inventory";
import { startTimer, stopTimer, woTotals } from "@/lib/wo";
import { CHECKIN_CONDITIONS, INSPECTION_TEMPLATES, QC_ITEMS } from "@/lib/checklists";

const refresh = (id: string) => { revalidatePath(`/os/${id}`); revalidatePath("/oficina/kanban"); };

async function baseUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

type Damage = { x: number; y: number; type: string; severity: string; note?: string };
function parseDamages(fd: FormData): Damage[] {
  try {
    const arr = JSON.parse(String(fd.get("damages") ?? "[]"));
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 60).map((d) => ({
      x: Math.min(1, Math.max(0, Number(d.x))), y: Math.min(1, Math.max(0, Number(d.y))),
      type: String(d.type).slice(0, 20), severity: String(d.severity).slice(0, 10), note: d.note ? String(d.note).slice(0, 200) : undefined,
    }));
  } catch { return []; }
}

function signatureFrom(fd: FormData) {
  const data = str(fd, "signature");
  if (!data) return null;
  if (!data.startsWith("data:image/png;base64,") || data.length > 400_000) throw new RuleError("Assinatura inválida.");
  return data;
}

async function sealCheckIn(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], checkInId: string, signedName: string, signature: string, user: SessionUser) {
  const meta = await requestMeta();
  const ci = await tx.checkIn.findUniqueOrThrow({ where: { id: checkInId }, include: { damages: true } });
  if (ci.locked) throw new RuleError("Check-in já assinado.");
  const signedAt = new Date();
  const { createdAt: _c, updatedAt: _u, ...content } = ci;
  const contentHash = sha256(JSON.stringify({ ...content, signedName, signature, signedAt }));
  await tx.checkIn.update({ where: { id: checkInId }, data: { signedName, signatureData: signature, signedAt, signedIp: meta.ip, signedUa: meta.userAgent, contentHash, locked: true } });
  await audit({ action: "SIGN", entity: "CheckIn", entityId: checkInId, userId: user.id, userName: user.name, after: { signedName, contentHash }, ...meta }, tx);
  await transition(tx, ci.workOrderId, "AGUARDANDO_DIAGNOSTICO", user, { reason: "Check-in assinado pelo cliente" });
}

// ───────────── Check-in ─────────────

export async function createCheckIn(_: ActionState, fd: FormData): Promise<ActionState> {
  let woId = "";
  const r = await run(async () => {
    const user = await assertUser("os:criar");
    const vehicleId = req(fd, "vehicleId", "Veículo");
    const vehicle = await db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    const open = await db.workOrder.findFirst({ where: { vehicleId, status: { notIn: ["ENTREGUE", "CANCELADA", "ENCERRADA_SEM_SERVICO"] } } });
    if (open) throw new RuleError(`Este veículo já tem a ${open.number} em aberto.`);
    const kmValue = int(fd, "km");
    if (kmValue === null || kmValue < 0) throw new RuleError("Informe a quilometragem.");
    const kmJust = str(fd, "kmJustification");
    if (kmValue < vehicle.mileage && !kmJust) throw new RuleError(`Km menor que o último registro (${vehicle.mileage.toLocaleString("pt-BR")}). Informe a justificativa.`);
    const fuel = int(fd, "fuelLevel");
    if (fuel === null || fuel < 0 || fuel > 100) throw new RuleError("Nível de combustível/carga deve estar entre 0 e 100%.");
    const complaint = req(fd, "complaint", "Reclamação do cliente");
    const signature = signatureFrom(fd);
    const signedName = str(fd, "signedName");
    if (signature && !signedName) throw new RuleError("Informe o nome de quem assinou.");
    const conditions = Object.fromEntries(CHECKIN_CONDITIONS.map((c) => [c, String(fd.get(`cond_${c}`) ?? "OK")]));
    const appointmentId = str(fd, "appointmentId");
    const promised = str(fd, "promisedAt");

    woId = await db.$transaction(async (tx) => {
      const number = await nextNumber(tx, user.branchId, "OS");
      const wo = await tx.workOrder.create({
        data: {
          number, branchId: user.branchId, customerId: vehicle.customerId, vehicleId, complaint, status: "CHECK_IN",
          consultantId: str(fd, "consultantId") ?? user.id, technicianId: str(fd, "technicianId"), bayId: str(fd, "bayId"),
          priority: str(fd, "priority") ?? "NORMAL", promisedAt: promised ? fromLocalInput(promised) : null, createdById: user.id,
        },
      });
      await tx.workOrderStatusHistory.create({ data: { workOrderId: wo.id, toStatus: "CHECK_IN", userId: user.id, userName: user.name, reason: "Check-in iniciado" } });
      if (appointmentId) await tx.appointment.update({ where: { id: appointmentId }, data: { workOrderId: wo.id, status: "CHEGOU" } });
      const ci = await tx.checkIn.create({
        data: {
          number: await nextNumber(tx, user.branchId, "CHK"), workOrderId: wo.id, km: kmValue, kmJustification: kmJust, fuelLevel: fuel,
          range: int(fd, "range"), broughtBy: req(fd, "broughtBy", "Quem trouxe o veículo"), broughtByRelation: str(fd, "broughtByRelation") ?? "TITULAR",
          arrivalMode: str(fd, "arrivalMode") ?? "RODANDO", dashLights: fd.getAll("dashLights").map(String), keysCount: int(fd, "keysCount") ?? 1,
          hasManual: bool(fd, "hasManual"), hasDocuments: bool(fd, "hasDocuments"), personalItems: str(fd, "personalItems"), accessories: str(fd, "accessories"),
          conditions, interiorNotes: str(fd, "interiorNotes"), exteriorNotes: str(fd, "exteriorNotes"), createdById: user.id,
          damages: { create: parseDamages(fd).map((d) => ({ ...d, view: "TOPO" })) },
        },
      });
      await tx.vehicle.update({ where: { id: vehicleId }, data: { mileage: kmValue } });
      await tx.odometerReading.create({ data: { vehicleId, km: kmValue, source: "CHECKIN", justification: kmJust, workOrderId: wo.id, userId: user.id } });
      await audit({ action: "CREATE", entity: "WorkOrder", entityId: wo.id, userId: user.id, userName: user.name, after: { number, vehicleId, km: kmValue, complaint }, ...(await requestMeta()) }, tx);
      if (signature && signedName) await sealCheckIn(tx, ci.id, signedName, signature, user);
      return wo.id;
    });
  });
  if (woId) redirect(`/os/${woId}`);
  return r;
}

export async function signCheckIn(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("os:criar");
    const id = String(fd.get("checkInId"));
    const signature = signatureFrom(fd);
    if (!signature) throw new RuleError("Colete a assinatura do cliente.");
    const name = req(fd, "signedName", "Nome de quem assina");
    const ci = await db.checkIn.findUniqueOrThrow({ where: { id } });
    await db.$transaction((tx) => sealCheckIn(tx, id, name, signature, user));
    refresh(ci.workOrderId);
    return "Check-in assinado e selado.";
  });
}

// ───────────── Dados gerais / status ─────────────

export async function updateWorkOrder(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("os:transicionar");
    const id = String(fd.get("id"));
    const before = await db.workOrder.findUniqueOrThrow({ where: { id } });
    if (["ENTREGUE", "CANCELADA"].includes(before.status)) throw new RuleError("OS encerrada.");
    const promised = str(fd, "promisedAt");
    const data = {
      technicianId: str(fd, "technicianId"), bayId: str(fd, "bayId"), consultantId: str(fd, "consultantId"),
      priority: str(fd, "priority") ?? "NORMAL", promisedAt: promised ? fromLocalInput(promised) : null, notes: str(fd, "notes"),
    };
    await db.$transaction(async (tx) => {
      await tx.workOrder.update({ where: { id }, data });
      await audit({ action: "UPDATE", entity: "WorkOrder", entityId: id, userId: user.id, userName: user.name, before: { technicianId: before.technicianId, bayId: before.bayId, promisedAt: before.promisedAt, priority: before.priority }, after: data }, tx);
    });
    refresh(id);
    return "OS atualizada.";
  });
}

export async function moveWorkOrder(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const to = String(fd.get("to")) as WorkOrderStatus;
    const user = await assertUser(to === "CANCELADA" ? "os:cancelar" : "os:transicionar");
    const id = String(fd.get("id"));
    await db.$transaction((tx) => transition(tx, id, to, user, { manual: true, reason: str(fd, "reason") ?? undefined, source: str(fd, "source") ?? "TELA" }));
    refresh(id);
    return `OS movida para "${STATUS_LABEL[to]}".`;
  });
}

// ───────────── Inspeção e diagnóstico ─────────────

export async function startInspection(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("os:diagnosticar");
    const woId = String(fd.get("workOrderId"));
    const template = String(fd.get("template"));
    const groups = INSPECTION_TEMPLATES[template];
    if (!groups) throw new RuleError("Modelo de checklist inválido.");
    let order = 0;
    await db.inspection.create({
      data: {
        workOrderId: woId, template, technicianId: user.id,
        items: { create: groups.flatMap((g) => g.items.map((label) => ({ group: g.group, label, sortOrder: order++ }))) },
      },
    });
    refresh(woId);
    return "Checklist iniciado.";
  });
}

export async function saveInspection(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("os:diagnosticar");
    const id = String(fd.get("inspectionId"));
    const insp = await db.inspection.findUniqueOrThrow({ where: { id }, include: { items: true } });
    if (insp.finishedAt) throw new RuleError("Checklist já finalizado.");
    const finish = fd.get("finish") === "1";
    await db.$transaction(async (tx) => {
      for (const it of insp.items) {
        const status = String(fd.get(`s_${it.id}`) ?? it.status) as typeof it.status;
        await tx.inspectionItem.update({ where: { id: it.id }, data: { status, measurement: str(fd, `m_${it.id}`), note: str(fd, `n_${it.id}`) } });
      }
      if (finish) await tx.inspection.update({ where: { id }, data: { finishedAt: new Date() } });
      await audit({ action: finish ? "FINISH" : "UPDATE", entity: "Inspection", entityId: id, userId: user.id, userName: user.name }, tx);
    });
    refresh(insp.workOrderId);
    return finish ? "Checklist finalizado." : "Checklist salvo.";
  });
}

export async function saveDiagnostic(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("os:diagnosticar");
    const woId = String(fd.get("workOrderId"));
    const wo = await db.workOrder.findUniqueOrThrow({ where: { id: woId } });
    if (!["AGUARDANDO_DIAGNOSTICO", "EM_DIAGNOSTICO", "EM_EXECUCAO", "AGUARDANDO_PECAS"].includes(wo.status))
      throw new RuleError("A OS não está em etapa de diagnóstico.");
    await db.$transaction(async (tx) => {
      if (wo.status === "AGUARDANDO_DIAGNOSTICO") {
        if (!wo.technicianId) await tx.workOrder.update({ where: { id: woId }, data: { technicianId: user.id } });
        await transition(tx, woId, "EM_DIAGNOSTICO", user, { reason: "Diagnóstico iniciado" });
      }
      const d = await tx.diagnostic.create({
        data: {
          workOrderId: woId, technicianId: user.id, technicianName: user.name, diagnosis: req(fd, "diagnosis", "Diagnóstico"),
          tests: str(fd, "tests"), faultCodes: str(fd, "faultCodes"), scanTool: str(fd, "scanTool"), probableCause: str(fd, "probableCause"),
          solution: str(fd, "solution"), finishedAt: new Date(),
        },
      });
      await audit({ action: "CREATE", entity: "Diagnostic", entityId: d.id, userId: user.id, userName: user.name, after: { workOrderId: woId } }, tx);
      if (bool(fd, "toEstimate") && (await tx.workOrder.findUniqueOrThrow({ where: { id: woId } })).status === "EM_DIAGNOSTICO")
        await transition(tx, woId, "ORCAMENTO", user, { reason: "Diagnóstico concluído" });
    });
    refresh(woId);
    return "Diagnóstico registrado.";
  });
}

// ───────────── Orçamento ─────────────

export async function createEstimate(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("orcamento:editar");
    const woId = String(fd.get("workOrderId"));
    const wo = await db.workOrder.findUniqueOrThrow({ where: { id: woId }, include: { estimates: true } });
    const draft = wo.estimates.find((e) => e.status === "RASCUNHO");
    if (draft) throw new RuleError(`Já existe o rascunho ${draft.number}.`);
    const hasInitial = wo.estimates.length > 0;
    if (!hasInitial && wo.status !== "ORCAMENTO") throw new RuleError('O orçamento inicial é criado quando a OS está em "Orçamento" (após o diagnóstico).');
    if (hasInitial && !["EM_EXECUCAO", "AGUARDANDO_PECAS", "ORCAMENTO", "AGUARDANDO_APROVACAO"].includes(wo.status))
      throw new RuleError("Orçamento complementar só pode ser criado durante a execução.");
    await db.$transaction(async (tx) => {
      const e = await tx.estimate.create({
        data: { number: await nextNumber(tx, wo.branchId, "ORC"), workOrderId: woId, kind: hasInitial ? "COMPLEMENTAR" : "INICIAL", createdById: user.id, validUntil: new Date(Date.now() + 7 * 86400_000) },
      });
      await audit({ action: "CREATE", entity: "Estimate", entityId: e.id, userId: user.id, userName: user.name, after: { number: e.number, kind: e.kind } }, tx);
    });
    refresh(woId);
    return "Orçamento criado.";
  });
}

async function draftEstimate(estimateId: string) {
  const e = await db.estimate.findUniqueOrThrow({ where: { id: estimateId } });
  if (e.status === "RESPONDIDO") throw new RuleError("Orçamento já respondido; não pode ser alterado.");
  return e;
}

export async function addEstimateItem(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("orcamento:editar");
    const estimateId = String(fd.get("estimateId"));
    const est = await draftEstimate(estimateId);
    const source = String(fd.get("source") ?? "manual");
    let type: ItemType, description: string, unitPrice: number, unitCost = 0, minutes: number | null = null;
    let serviceId: string | null = null, inventoryItemId: string | null = null;
    const quantity = num(fd, "quantity") ?? 1;
    if (quantity <= 0) throw new RuleError("Quantidade deve ser maior que zero.");

    if (source === "service") {
      const s = await db.serviceCatalog.findUniqueOrThrow({ where: { id: req(fd, "serviceId", "Serviço") } });
      type = "SERVICO"; description = s.name; serviceId = s.id; minutes = int(fd, "minutes") ?? s.standardMin;
      unitPrice = s.fixedPrice ?? Math.round((minutes / 60) * s.hourlyRate);
    } else if (source === "stock") {
      const i = await db.inventoryItem.findUniqueOrThrow({ where: { id: req(fd, "inventoryItemId", "Item de estoque") } });
      type = i.category === "CONSUMIVEIS" ? "CONSUMIVEL" : "PECA"; description = i.name; inventoryItemId = i.id; unitPrice = i.price; unitCost = i.avgCost;
    } else {
      type = (String(fd.get("type")) as ItemType) || "SERVICO";
      if (!["SERVICO", "PECA", "CONSUMIVEL", "TERCEIRO", "TAXA"].includes(type)) throw new RuleError("Tipo inválido.");
      description = req(fd, "description", "Descrição");
      unitPrice = parseMoney(fd.get("unitPrice"));
      unitCost = parseMoney(fd.get("unitCost"));
      if (type === "SERVICO") minutes = int(fd, "minutes") ?? 60;
    }
    if (source !== "manual" && str(fd, "unitPrice")) unitPrice = parseMoney(fd.get("unitPrice"));
    if (unitPrice < 0) throw new RuleError("Preço inválido.");

    const gross = lineGross({ quantity, unitPrice });
    const pct = num(fd, "discountPct") ?? 0;
    const discount = Math.round(gross * (pct / 100));
    const limit = discountLimit(user.role);
    if (pct < 0 || pct > 100) throw new RuleError("Desconto inválido.");
    if (pct > limit) throw new RuleError(`Desconto de ${pct}% acima do seu limite (${limit}%). Solicite a um gestor.`);

    const classification = (String(fd.get("classification") ?? "OBRIGATORIO")) as ItemClass;
    const count = await db.estimateItem.count({ where: { estimateId } });
    await db.$transaction(async (tx) => {
      const it = await tx.estimateItem.create({
        data: { estimateId, type, classification, description, quantity, minutes, unitPrice, unitCost, discount, serviceId, inventoryItemId, sortOrder: count },
      });
      await audit({ action: "ADD_ITEM", entity: "Estimate", entityId: estimateId, userId: user.id, userName: user.name, after: { itemId: it.id, description, quantity, unitPrice, discount, pct } }, tx);
    });
    refresh(est.workOrderId);
    return "Item adicionado.";
  });
}

export async function removeEstimateItem(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("orcamento:editar");
    const item = await db.estimateItem.findUniqueOrThrow({ where: { id: String(fd.get("itemId")) }, include: { estimate: true } });
    await draftEstimate(item.estimateId);
    await db.$transaction(async (tx) => {
      await tx.estimateItem.delete({ where: { id: item.id } });
      await audit({ action: "REMOVE_ITEM", entity: "Estimate", entityId: item.estimateId, userId: user.id, userName: user.name, before: { description: item.description, unitPrice: item.unitPrice, quantity: item.quantity } }, tx);
    });
    refresh(item.estimate.workOrderId);
    return "Item removido do rascunho. As versões já enviadas continuam preservadas.";
  });
}

export async function sendEstimateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("orcamento:editar");
    const id = String(fd.get("estimateId"));
    const { version, token } = await db.$transaction((tx) => sendEstimate(tx, id, user));
    const est = await db.estimate.findUniqueOrThrow({ where: { id } });
    refresh(est.workOrderId);
    const link = `${await baseUrl()}/aprovar/${token}`;
    return { message: `Versão ${version.version} enviada (${money(version.total)}). Envie o link abaixo ao cliente. (Envio automático por WhatsApp/e-mail: canal ainda não configurado.)`, data: { link } };
  });
}

export async function newApprovalLink(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("orcamento:editar");
    const versionId = String(fd.get("versionId"));
    const v = await db.estimateVersion.findUniqueOrThrow({ where: { id: versionId }, include: { estimate: true } });
    if (v.estimate.status !== "ENVIADO") throw new RuleError("Este orçamento não está aguardando resposta.");
    const token = await db.$transaction(async (tx) => {
      const t = await createApprovalLink(tx, versionId, user);
      await audit({ action: "NEW_LINK", entity: "EstimateVersion", entityId: versionId, userId: user.id, userName: user.name }, tx);
      return t;
    });
    return { message: "Novo link gerado. Os links anteriores foram revogados.", data: { link: `${await baseUrl()}/aprovar/${token}` } };
  });
}

export async function registerApproval(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("orcamento:registrar_aprovacao");
    const versionId = String(fd.get("versionId"));
    const v = await db.estimateVersion.findUniqueOrThrow({ where: { id: versionId }, include: { estimate: true } });
    const snap = v.snapshot as unknown as Snapshot;
    const decisions = snap.items.map((i) => ({ itemId: i.id, decision: fd.get(`d_${i.id}`) === "APROVADO" ? "APROVADO" as const : "RECUSADO" as const }));
    const meta = await requestMeta();
    const res = await db.$transaction((tx) => recordDecisions(tx, versionId, decisions, {
      channel: String(fd.get("channel") ?? "PRESENCIAL"), approverName: req(fd, "approverName", "Nome de quem aprovou"),
      evidence: str(fd, "evidence"), removedPartsDestination: str(fd, "removedParts"), ip: meta.ip, userAgent: meta.userAgent,
    }, user));
    refresh(v.estimate.workOrderId);
    return `Resposta registrada: ${res.approved} de ${res.total} item(ns) aprovado(s).`;
  });
}

// ───────────── Execução ─────────────

export async function timerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("os:executar");
    const serviceId = String(fd.get("serviceId"));
    const op = String(fd.get("op"));
    const svc = await db.workOrderService.findUniqueOrThrow({ where: { id: serviceId } });
    await db.$transaction((tx) => op === "start" ? startTimer(tx, user, serviceId) : stopTimer(tx, user, serviceId, op === "finish" ? "FINALIZADO" : op === "parts" ? "AGUARDANDO_PECA" : "PAUSA"));
    refresh(svc.workOrderId);
    revalidatePath("/os");
    return op === "start" ? "Serviço iniciado." : op === "finish" ? "Serviço concluído." : "Apontamento pausado.";
  });
}

export async function partAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("estoque:requisitar");
    const partId = String(fd.get("partId"));
    const op = String(fd.get("op"));
    const part = await db.workOrderPart.findUniqueOrThrow({ where: { id: partId } });
    await db.$transaction((tx) => op === "apply" ? applyPart(tx, user, partId) : returnPart(tx, user, partId, str(fd, "reason") ?? ""));
    refresh(part.workOrderId);
    return op === "apply" ? "Peça baixada do estoque e aplicada na OS." : "Peça devolvida.";
  });
}

// ───────────── Controle de qualidade ─────────────

export async function submitQC(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("os:cq");
    const woId = String(fd.get("workOrderId"));
    const wo = await db.workOrder.findUniqueOrThrow({ where: { id: woId }, include: { timeEntries: true, services: true } });
    if (wo.status !== "CONTROLE_QUALIDADE") throw new RuleError("A OS não está em controle de qualidade.");
    if (user.role !== "ADMIN" && wo.timeEntries.some((t) => t.technicianId === user.id))
      throw new RuleError("Segregação de funções: quem executou serviços nesta OS não pode fazer o CQ.");
    const checklist = Object.fromEntries(QC_ITEMS.map((q, i) => [q, bool(fd, `qc_${i}`)]));
    const approved = fd.get("result") === "APROVADO";
    if (approved && Object.values(checklist).some((v) => !v)) throw new RuleError("Para aprovar, todos os itens do checklist devem estar conferidos.");
    const reopen = fd.getAll("reopen").map(String);
    if (!approved && !reopen.length) throw new RuleError("Na reprovação, selecione os serviços que precisam ser refeitos.");
    const notes = str(fd, "notes");
    if (!approved && !notes) throw new RuleError("Descreva as pendências da reprovação.");
    const td = bool(fd, "testDrive") ? { kmOut: int(fd, "tdKmOut"), kmIn: int(fd, "tdKmIn"), driver: str(fd, "tdDriver"), authorized: bool(fd, "tdAuthorized") } : null;
    if (td && !td.authorized) throw new RuleError("Teste de rodagem exige autorização do cliente registrada.");
    await db.$transaction(async (tx) => {
      await tx.qualityControl.create({ data: { workOrderId: woId, inspectorId: user.id, inspectorName: user.name, result: approved ? "APROVADO" : "REPROVADO", checklist, testDrive: td ?? undefined, notes } });
      if (approved) {
        await transition(tx, woId, "PREPARACAO", user, { reason: "CQ aprovado" });
      } else {
        await tx.workOrderService.updateMany({ where: { id: { in: reopen }, workOrderId: woId }, data: { status: "PENDENTE", finishedAt: null } });
        await transition(tx, woId, "EM_EXECUCAO", user, { reason: `CQ reprovado: ${notes}` });
      }
    });
    refresh(woId);
    return approved ? "CQ aprovado. OS segue para preparação." : "CQ reprovado. OS voltou para execução.";
  });
}

// ───────────── Pagamento e check-out ─────────────

async function totalsFor(woId: string) {
  const wo = await db.workOrder.findUniqueOrThrow({ where: { id: woId }, include: { services: true, parts: true, payments: true, timeEntries: true } });
  return { wo, t: woTotals({ ...wo, techCost: new Map() }) };
}

export async function registerPayment(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("pagamentos:registrar");
    const woId = String(fd.get("workOrderId"));
    const { wo, t } = await totalsFor(woId);
    if (wo.status === "CANCELADA") throw new RuleError("OS cancelada.");
    const amount = parseMoney(fd.get("amount"));
    if (amount <= 0) throw new RuleError("Valor inválido.");
    if (amount > t.due) throw new RuleError(`Valor maior que o saldo em aberto (${money(t.due)}).`);
    const method = req(fd, "method", "Forma de pagamento");
    await db.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: { number: await nextNumber(tx, wo.branchId, "REC"), workOrderId: woId, method, amount, installments: int(fd, "installments") ?? 1, reference: str(fd, "reference"), userId: user.id, userName: user.name },
      });
      await audit({ action: "PAYMENT", entity: "Payment", entityId: p.id, userId: user.id, userName: user.name, after: { workOrderId: woId, amount, method }, ...(await requestMeta()) }, tx);
    });
    refresh(woId);
    return `Pagamento de ${money(amount)} registrado. (Emissão fiscal: módulo Fiscal ainda não implementado — Fase 4.)`;
  });
}

export async function reversePayment(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("pagamentos:estornar");
    const p = await db.payment.findUniqueOrThrow({ where: { id: String(fd.get("paymentId")) }, include: { workOrder: true } });
    if (p.status !== "CONFIRMADO") throw new RuleError("Pagamento já estornado.");
    if (p.workOrder.status === "ENTREGUE") throw new RuleError("OS entregue: estornos após a entrega devem ser tratados no Financeiro (Fase 4).");
    const reason = req(fd, "reason", "Motivo do estorno");
    await db.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: p.id }, data: { status: "ESTORNADO", reversedReason: reason } });
      await audit({ action: "REVERSE", entity: "Payment", entityId: p.id, userId: user.id, userName: user.name, before: { status: "CONFIRMADO" }, after: { status: "ESTORNADO", reason } }, tx);
    });
    refresh(p.workOrderId);
    return "Pagamento estornado.";
  });
}

export async function checkOut(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("os:checkout");
    const woId = String(fd.get("workOrderId"));
    const { wo, t } = await totalsFor(woId);
    if (!["PRONTO_ENTREGA", "ENCERRADA_SEM_SERVICO"].includes(wo.status)) throw new RuleError('A OS precisa estar "Pronta para entrega".');
    const ci = await db.checkIn.findUnique({ where: { workOrderId: woId } });
    const kmOut = int(fd, "km");
    if (kmOut === null) throw new RuleError("Informe a quilometragem de saída.");
    if (ci && kmOut < ci.km) throw new RuleError(`Km de saída menor que a de entrada (${ci.km}).`);
    const fuel = int(fd, "fuelLevel");
    if (fuel === null || fuel < 0 || fuel > 100) throw new RuleError("Nível de combustível/carga inválido.");
    const release = bool(fd, "releaseWithoutPayment");
    const releaseReason = str(fd, "releaseReason");
    if (t.due > 0) {
      if (!release) throw new RuleError(`Há saldo em aberto de ${money(t.due)}. Registre o pagamento ou solicite liberação ao gestor.`);
      if (!can(user.role, "os:liberar_sem_pagamento")) throw new RuleError("Somente gestor pode liberar a entrega sem pagamento.");
      if (!releaseReason) throw new RuleError("Informe o motivo da liberação sem pagamento.");
    }
    const signature = signatureFrom(fd);
    if (!signature) throw new RuleError("Colete a assinatura de quem está retirando o veículo.");
    const signedName = req(fd, "signedName", "Nome de quem retira");
    const meta = await requestMeta();
    const content = {
      workOrderId: woId, km: kmOut, fuelLevel: fuel, receivedBy: signedName, receivedByRelation: str(fd, "relation") ?? "TITULAR",
      finalCondition: str(fd, "finalCondition"), recommendations: str(fd, "recommendations"), removedPartsReturned: bool(fd, "removedPartsReturned"),
      releasedWithoutPayment: t.due > 0 && release, releaseReason: t.due > 0 ? releaseReason : null,
    };
    await db.$transaction(async (tx) => {
      const co = await tx.checkOut.create({
        data: {
          ...content, deliveredById: user.id, deliveredByName: user.name, signedName, signatureData: signature, signedIp: meta.ip, signedUa: meta.userAgent,
          contentHash: sha256(JSON.stringify({ ...content, total: t.total, paid: t.paid, signature, at: new Date() })),
        },
      });
      await tx.vehicle.update({ where: { id: wo.vehicleId }, data: { mileage: kmOut } });
      await tx.odometerReading.create({ data: { vehicleId: wo.vehicleId, km: kmOut, source: "CHECKOUT", workOrderId: woId, userId: user.id } });
      await audit({ action: "CHECKOUT", entity: "WorkOrder", entityId: woId, userId: user.id, userName: user.name, after: { checkOutId: co.id, total: t.total, paid: t.paid, released: content.releasedWithoutPayment, releaseReason }, ...meta }, tx);
      await transition(tx, woId, "ENTREGUE", user, { reason: content.releasedWithoutPayment ? `Entregue sem pagamento integral: ${releaseReason}` : "Check-out assinado" });
    });
    refresh(woId);
    return "Veículo entregue. Check-out selado.";
  });
}
