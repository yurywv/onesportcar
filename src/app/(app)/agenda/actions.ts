"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { assertUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, str, req, int, bool, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import { fromLocalInput } from "@/lib/format";

async function checkConflicts(startsAt: Date, durationMin: number, bayId: string | null, technicianId: string | null, exceptId?: string) {
  if (!bayId && !technicianId) return;
  const end = new Date(startsAt.getTime() + durationMin * 60000);
  const candidates = await db.appointment.findMany({
    where: {
      id: exceptId ? { not: exceptId } : undefined,
      status: { in: ["AGENDADO", "CONFIRMADO"] },
      startsAt: { lt: end, gte: new Date(startsAt.getTime() - 24 * 3600_000) },
      OR: [...(bayId ? [{ bayId }] : []), ...(technicianId ? [{ technicianId }] : [])],
    },
    include: { vehicle: true, bay: true },
  });
  const clash = candidates.find((a) => new Date(a.startsAt.getTime() + a.durationMin * 60000) > startsAt);
  if (clash) {
    const what = clash.bayId === bayId ? `o box ${clash.bay?.code}` : "o técnico";
    throw new RuleError(`Conflito: ${what} já está reservado para ${clash.vehicle.model} nesse horário.`);
  }
}

export async function saveAppointment(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("agenda:editar");
    const id = str(fd, "id");
    const vehicleId = req(fd, "vehicleId", "Veículo");
    const vehicle = await db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    const startsAt = fromLocalInput(req(fd, "startsAt", "Data e hora"));
    if (!id && startsAt < new Date(Date.now() - 3600_000)) throw new RuleError("Não é possível agendar no passado.");
    const durationMin = int(fd, "durationMin") ?? 60;
    const bayId = str(fd, "bayId"), technicianId = str(fd, "technicianId");
    await checkConflicts(startsAt, durationMin, bayId, technicianId, id ?? undefined);
    const data = {
      customerId: vehicle.customerId, vehicleId, startsAt, durationMin, bayId, technicianId,
      consultantId: str(fd, "consultantId") ?? user.id, services: str(fd, "services"), complaint: str(fd, "complaint"),
      priority: str(fd, "priority") ?? "NORMAL", pickup: bool(fd, "pickup"), pickupAddress: str(fd, "pickupAddress"), notes: str(fd, "notes"),
    };
    await db.$transaction(async (tx) => {
      if (id) {
        const before = await tx.appointment.findUniqueOrThrow({ where: { id } });
        if (before.workOrderId) throw new RuleError("Agendamento já convertido em OS.");
        await tx.appointment.update({ where: { id }, data });
        await audit({ action: before.startsAt.getTime() !== startsAt.getTime() ? "RESCHEDULE" : "UPDATE", entity: "Appointment", entityId: id, userId: user.id, userName: user.name, before: { startsAt: before.startsAt, bayId: before.bayId, technicianId: before.technicianId }, after: { startsAt, bayId, technicianId } }, tx);
      } else {
        const a = await tx.appointment.create({ data: { ...data, branchId: user.branchId, createdById: user.id } });
        await audit({ action: "CREATE", entity: "Appointment", entityId: a.id, userId: user.id, userName: user.name, after: data }, tx);
      }
    });
    revalidatePath("/agenda");
    return id ? "Agendamento atualizado." : "Agendamento criado. (Confirmação automática ao cliente: canal ainda não configurado.)";
  });
}

export async function setAppointmentStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("agenda:editar");
    const id = String(fd.get("id"));
    const status = String(fd.get("status")) as "CONFIRMADO" | "NAO_COMPARECEU" | "CANCELADO";
    if (!["CONFIRMADO", "NAO_COMPARECEU", "CANCELADO"].includes(status)) throw new RuleError("Status inválido.");
    const reason = str(fd, "reason");
    if (status === "CANCELADO" && !reason) throw new RuleError("Informe o motivo do cancelamento.");
    const before = await db.appointment.findUniqueOrThrow({ where: { id } });
    if (before.workOrderId) throw new RuleError("Agendamento já convertido em OS.");
    await db.$transaction(async (tx) => {
      await tx.appointment.update({ where: { id }, data: { status, cancelReason: reason } });
      await audit({ action: "STATUS", entity: "Appointment", entityId: id, userId: user.id, userName: user.name, before: { status: before.status }, after: { status, reason } }, tx);
    });
    revalidatePath("/agenda");
    return "Agendamento atualizado.";
  });
}
