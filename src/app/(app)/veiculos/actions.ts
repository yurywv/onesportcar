"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Propulsion } from "@prisma/client";
import { db } from "@/lib/db";
import { assertUser, requestMeta } from "@/lib/auth";
import { audit, diff } from "@/lib/audit";
import { run, str, req, int, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import { isValidPlate, isValidRenavam, isValidVIN, normalizePlate } from "@/lib/validators";

const PROPULSIONS = ["GASOLINA", "ETANOL", "FLEX", "DIESEL", "HIBRIDO", "HIBRIDO_PLUGIN", "ELETRICO"];

function parse(fd: FormData) {
  const plate = normalizePlate(req(fd, "plate", "Placa"));
  if (!isValidPlate(plate)) throw new RuleError("Placa inválida (formatos AAA9999 ou AAA9A99).");
  const vin = str(fd, "vin")?.toUpperCase() ?? null;
  if (vin && !isValidVIN(vin)) throw new RuleError("Chassi/VIN inválido: 17 caracteres, sem I, O ou Q.");
  const renavam = str(fd, "renavam");
  if (renavam && !isValidRenavam(renavam)) throw new RuleError("RENAVAM inválido.");
  const propulsion = String(fd.get("propulsion"));
  const year = (k: string) => { const y = int(fd, k); if (y && (y < 1950 || y > new Date().getFullYear() + 1)) throw new RuleError("Ano inválido."); return y; };
  return {
    plate, vin, renavam,
    make: req(fd, "make", "Marca"), model: req(fd, "model", "Modelo"), version: str(fd, "version"),
    yearMfg: year("yearMfg"), yearModel: year("yearModel"), color: str(fd, "color"),
    propulsion: (PROPULSIONS.includes(propulsion) ? propulsion : "GASOLINA") as Propulsion,
    engine: str(fd, "engine"), transmission: str(fd, "transmission"), traction: str(fd, "traction"), power: str(fd, "power"),
    notes: str(fd, "notes"),
  };
}

export async function createVehicle(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await run(async () => {
    const user = await assertUser("veiculos:editar");
    const customerId = req(fd, "customerId", "Cliente");
    const data = parse(fd);
    const mileage = int(fd, "mileage") ?? 0;
    const v = await db.$transaction(async (tx) => {
      const v = await tx.vehicle.create({ data: { ...data, customerId, mileage } });
      await tx.vehicleOwnership.create({ data: { vehicleId: v.id, customerId } });
      await tx.odometerReading.create({ data: { vehicleId: v.id, km: mileage, source: "MANUAL", userId: user.id } });
      await audit({ action: "CREATE", entity: "Vehicle", entityId: v.id, userId: user.id, userName: user.name, after: { ...data, customerId, mileage }, ...(await requestMeta()) }, tx);
      return v;
    });
    id = v.id;
  });
  if (id) redirect(`/veiculos/${id}`);
  return r;
}

export async function updateVehicle(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("veiculos:editar");
    const id = String(fd.get("id"));
    const before = await db.vehicle.findUniqueOrThrow({ where: { id } });
    const data = parse(fd);
    const d = diff(before as unknown as Record<string, unknown>, data);
    if (!d.changed) return "Nenhuma alteração.";
    await db.$transaction(async (tx) => {
      await tx.vehicle.update({ where: { id }, data });
      await audit({ action: "UPDATE", entity: "Vehicle", entityId: id, userId: user.id, userName: user.name, before: d.before, after: d.after, ...(await requestMeta()) }, tx);
    });
    revalidatePath(`/veiculos/${id}`);
    return "Veículo atualizado.";
  });
}

/** Troca de proprietário: encerra o vínculo atual e abre um novo (histórico preservado). */
export async function transferVehicle(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("veiculos:editar");
    const id = String(fd.get("id"));
    const customerId = req(fd, "customerId", "Novo proprietário");
    const v = await db.vehicle.findUniqueOrThrow({ where: { id } });
    if (v.customerId === customerId) throw new RuleError("Este cliente já é o proprietário.");
    const open = await db.workOrder.count({ where: { vehicleId: id, status: { notIn: ["ENTREGUE", "CANCELADA"] } } });
    if (open) throw new RuleError("Há OS em aberto para este veículo. Conclua-a antes de transferir.");
    await db.$transaction(async (tx) => {
      await tx.vehicleOwnership.updateMany({ where: { vehicleId: id, endedAt: null }, data: { endedAt: new Date() } });
      await tx.vehicleOwnership.create({ data: { vehicleId: id, customerId } });
      await tx.vehicle.update({ where: { id }, data: { customerId } });
      await audit({ action: "TRANSFER", entity: "Vehicle", entityId: id, userId: user.id, userName: user.name, before: { customerId: v.customerId }, after: { customerId } }, tx);
    });
    revalidatePath(`/veiculos/${id}`);
    return "Proprietário alterado.";
  });
}

export async function addOdometer(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("veiculos:editar");
    const id = String(fd.get("id"));
    const value = int(fd, "km");
    if (value === null || value < 0) throw new RuleError("Quilometragem inválida.");
    const v = await db.vehicle.findUniqueOrThrow({ where: { id } });
    const justification = str(fd, "justification");
    if (value < v.mileage && !justification) throw new RuleError(`Quilometragem menor que a última registrada (${v.mileage}). Informe a justificativa (ex.: troca de painel).`);
    await db.$transaction(async (tx) => {
      await tx.odometerReading.create({ data: { vehicleId: id, km: value, source: "MANUAL", justification, userId: user.id } });
      await tx.vehicle.update({ where: { id }, data: { mileage: value } });
      await audit({ action: "ODOMETER", entity: "Vehicle", entityId: id, userId: user.id, userName: user.name, before: { mileage: v.mileage }, after: { mileage: value, justification } }, tx);
    });
    revalidatePath(`/veiculos/${id}`);
    return "Quilometragem registrada.";
  });
}
