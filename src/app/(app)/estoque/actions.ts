"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { assertUser } from "@/lib/auth";
import { audit, diff } from "@/lib/audit";
import { run, str, req, num, type ActionState } from "@/lib/action";
import { parseMoney } from "@/lib/format";
import { stockEntry, stockAdjust } from "@/lib/inventory";
import { RuleError } from "@/lib/workflow";

const CATS = ["PECAS", "OLEOS", "FLUIDOS", "FILTROS", "PNEUS", "QUIMICOS", "CONSUMIVEIS", "ACESSORIOS"];

function fiscalFields(fd: FormData) {
  const digits = (k: string, len: number[], label: string) => {
    const v = str(fd, k)?.replace(/\D/g, "") || null;
    if (v && !len.includes(v.length)) throw new RuleError(`${label} deve ter ${len.join(" ou ")} dígitos.`);
    return v;
  };
  const origin = num(fd, "origin") ?? 0;
  if (origin < 0 || origin > 8) throw new RuleError("Origem inválida.");
  return {
    ncm: digits("ncm", [8], "NCM"), cest: digits("cest", [7], "CEST"), gtin: digits("gtin", [8, 12, 13, 14], "GTIN"),
    cfop: str(fd, "cfop"), cstIcms: str(fd, "cstIcms"), origin,
  };
}

export async function saveItem(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("estoque:movimentar");
    const id = str(fd, "id");
    const category = String(fd.get("category"));
    if (!CATS.includes(category)) throw new RuleError("Categoria inválida.");
    const data = {
      sku: req(fd, "sku", "SKU").toUpperCase(), name: req(fd, "name", "Descrição"), oemCode: str(fd, "oemCode"), mfrCode: str(fd, "mfrCode"),
      brand: str(fd, "brand"), category, unit: str(fd, "unit")?.toUpperCase() ?? "UN", location: str(fd, "location"),
      price: parseMoney(fd.get("price")), minQty: num(fd, "minQty") ?? 0, maxQty: num(fd, "maxQty"), supplierId: str(fd, "supplierId"),
      ...fiscalFields(fd),
    };
    await db.$transaction(async (tx) => {
      if (id) {
        const before = await tx.inventoryItem.findUniqueOrThrow({ where: { id } });
        const d = diff(before as unknown as Record<string, unknown>, data);
        await tx.inventoryItem.update({ where: { id }, data });
        await audit({ action: "UPDATE", entity: "InventoryItem", entityId: id, userId: user.id, userName: user.name, before: d.before, after: d.after }, tx);
      } else {
        const it = await tx.inventoryItem.create({ data });
        await audit({ action: "CREATE", entity: "InventoryItem", entityId: it.id, userId: user.id, userName: user.name, after: data }, tx);
      }
    });
    revalidatePath("/estoque");
    return id ? "Item atualizado." : "Item cadastrado. Saldo inicial deve ser lançado como entrada.";
  });
}

export async function moveStock(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("estoque:movimentar");
    const itemId = String(fd.get("itemId"));
    const kind = String(fd.get("kind"));
    const qty = num(fd, "quantity");
    if (qty === null) throw new RuleError("Informe a quantidade.");
    await db.$transaction(async (tx) => {
      if (kind === "ENTRADA") await stockEntry(tx, user, itemId, qty, parseMoney(fd.get("unitCost")), str(fd, "reference") ?? undefined);
      else if (kind === "AJUSTE") {
        if (!["ADMIN", "GESTOR", "ESTOQUISTA"].includes(user.role)) throw new RuleError("Ajustes exigem perfil de estoquista ou gestor.");
        await stockAdjust(tx, user, itemId, qty, str(fd, "reason") ?? "");
      } else throw new RuleError("Movimento inválido.");
    });
    revalidatePath(`/estoque/${itemId}`);
    revalidatePath("/estoque");
    return kind === "ENTRADA" ? "Entrada registrada. Peças aguardando compra foram reservadas quando possível." : "Ajuste registrado.";
  });
}
