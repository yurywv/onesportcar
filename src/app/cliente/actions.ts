"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requestMeta } from "@/lib/auth";
import { customerLogin, customerLogout, activateWithInvite, requireCustomer } from "@/lib/customer-auth";
import { run, req, str, bool, type ActionState } from "@/lib/action";
import { recordDecisions, type Snapshot } from "@/lib/estimate";
import { RuleError } from "@/lib/workflow";
import { audit } from "@/lib/audit";

export async function portalLogin(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await customerLogin(String(fd.get("document") ?? ""), String(fd.get("password") ?? ""));
  if (!r.ok) return { error: r.error, at: Date.now() };
  redirect("/cliente");
}

export async function portalLogout() {
  await customerLogout();
  redirect("/cliente/entrar");
}

export async function portalActivate(_: ActionState, fd: FormData): Promise<ActionState> {
  const p1 = String(fd.get("password") ?? ""), p2 = String(fd.get("password2") ?? "");
  if (p1 !== p2) return { error: "As senhas não conferem.", at: Date.now() };
  const r = await activateWithInvite(String(fd.get("token") ?? ""), p1);
  if (!r.ok) return { error: r.error, at: Date.now() };
  redirect("/cliente");
}

// Horário de atendimento para agendamento pelo app: seg–sex 8h–17h, sáb 8h–12h (horário de Brasília). Até 3 carros por horário.
const SLOT_CAPACITY = 3;
export async function portalSchedule(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const c = await requireCustomer();
    const vehicleId = req(fd, "vehicleId", "Veículo");
    const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId, customerId: c.id } });
    if (!vehicle) throw new RuleError("Veículo não encontrado.");
    const day = req(fd, "date", "Data"), hour = req(fd, "time", "Horário");
    const startsAt = new Date(`${day}T${hour}:00-03:00`);
    if (Number.isNaN(+startsAt)) throw new RuleError("Data ou horário inválido.");
    if (+startsAt < Date.now() + 2 * 3600_000) throw new RuleError("Escolha um horário com pelo menos 2 horas de antecedência.");
    if (+startsAt > Date.now() + 60 * 86400_000) throw new RuleError("Agendamentos pelo app vão até 60 dias à frente.");
    const local = new Date(+startsAt - 3 * 3600_000);
    const dow = local.getUTCDay(), h = local.getUTCHours();
    if (dow === 0 || (dow === 6 ? h < 8 || h >= 12 : h < 8 || h >= 17)) throw new RuleError("Atendemos de segunda a sexta, das 8h às 17h, e aos sábados, das 8h às 12h.");
    const kind = fd.get("kind") === "DIAGNOSTICO" ? "DIAGNOSTICO" : "SERVICO";
    const complaint = req(fd, "complaint", kind === "DIAGNOSTICO" ? "O que o veículo está apresentando" : "Serviço desejado");
    const busy = await db.appointment.count({ where: { startsAt: { gte: startsAt, lt: new Date(+startsAt + 3600_000) }, status: { in: ["AGENDADO", "CONFIRMADO", "CHEGOU"] } } });
    if (busy >= SLOT_CAPACITY) throw new RuleError("Este horário já está cheio. Escolha outro, por favor.");
    const open = await db.appointment.findFirst({ where: { vehicleId, status: { in: ["AGENDADO", "CONFIRMADO"] }, startsAt: { gte: new Date() } } });
    if (open) throw new RuleError("Este veículo já tem um agendamento em aberto. Fale com a recepção para remarcar.");
    const branch = await db.branch.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const a = await db.appointment.create({
      data: {
        branchId: branch.id, customerId: c.id, vehicleId, startsAt, durationMin: 60, kind, origin: "PORTAL",
        services: kind === "DIAGNOSTICO" ? "Diagnóstico" : str(fd, "service") ?? "Serviço", complaint,
        pickup: bool(fd, "pickup"), pickupAddress: str(fd, "pickupAddress"), createdById: "APP_CLIENTE",
      },
    });
    await audit({ action: "CREATE", entity: "Appointment", entityId: a.id, userName: `Cliente: ${c.name}`, after: { startsAt, kind, origin: "PORTAL" }, ...(await requestMeta()) });
    revalidatePath("/cliente"); revalidatePath("/agenda");
    return "Agendamento solicitado! A recepção vai confirmar pelo WhatsApp.";
  });
}

export async function portalCancelAppointment(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const c = await requireCustomer();
    const a = await db.appointment.findFirst({ where: { id: String(fd.get("id")), customerId: c.id, status: { in: ["AGENDADO", "CONFIRMADO"] }, workOrderId: null } });
    if (!a) throw new RuleError("Agendamento não encontrado.");
    await db.appointment.update({ where: { id: a.id }, data: { status: "CANCELADO", cancelReason: "Cancelado pelo cliente no app" } });
    revalidatePath("/cliente"); revalidatePath("/agenda");
    return "Agendamento cancelado.";
  });
}

export async function portalDecision(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const c = await requireCustomer();
    const version = await db.estimateVersion.findUnique({ where: { id: String(fd.get("versionId")) }, include: { estimate: { include: { workOrder: true } } } });
    if (!version || version.estimate.workOrder.customerId !== c.id) throw new RuleError("Orçamento não encontrado.");
    if (!bool(fd, "accept")) throw new RuleError("Confirme que leu e autoriza os itens selecionados.");
    const snap = version.snapshot as unknown as Snapshot;
    const meta = await requestMeta();
    const res = await db.$transaction((tx) => recordDecisions(tx, version.id, snap.items.map((i) => ({ itemId: i.id, decision: fd.get(`d_${i.id}`) === "APROVADO" ? "APROVADO" : "RECUSADO" })), {
      channel: "APP", approverName: req(fd, "name", "Seu nome"), removedPartsDestination: str(fd, "removedParts"), ip: meta.ip, userAgent: meta.userAgent,
      evidence: `Aceite eletrônico no app do cliente (sessão de ${c.document})`,
    }, null));
    revalidatePath(`/cliente/os/${version.estimate.workOrderId}`); revalidatePath(`/os/${version.estimate.workOrderId}`);
    return res.approved ? `Obrigado! ${res.approved} de ${res.total} item(ns) aprovado(s). A ordem de serviço foi liberada para execução.` : "Resposta registrada. Nenhum item aprovado — seu consultor vai entrar em contato.";
  });
}
