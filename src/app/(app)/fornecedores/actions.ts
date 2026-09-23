"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { assertUser } from "@/lib/auth";
import { audit, diff } from "@/lib/audit";
import { run, str, req, int, bool, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import { parseTerms } from "@/lib/finance";
import { isValidCNPJ, isValidCPF, isValidEmail, normalizeDocument } from "@/lib/validators";

function parse(fd: FormData) {
  const type = fd.get("type") === "PF" ? "PF" : "PJ";
  const document = normalizeDocument(type, req(fd, "document", type === "PJ" ? "CNPJ" : "CPF"));
  if (type === "PJ" ? !isValidCNPJ(document) : !isValidCPF(document)) throw new RuleError(type === "PJ" ? "CNPJ inválido." : "CPF inválido.");
  const email = str(fd, "email")?.toLowerCase() ?? null;
  if (email && !isValidEmail(email)) throw new RuleError("E-mail inválido.");
  const paymentTerms = str(fd, "paymentTerms");
  if (paymentTerms) parseTerms(paymentTerms);
  const rating = int(fd, "rating");
  if (rating !== null && (rating < 1 || rating > 5)) throw new RuleError("Avaliação de 1 a 5.");
  return {
    type, document, email, name: req(fd, "name", "Razão social"), tradeName: str(fd, "tradeName"), ie: str(fd, "ie"),
    contactName: str(fd, "contactName"), phone: str(fd, "phone"), whatsapp: str(fd, "whatsapp"),
    cep: str(fd, "cep"), street: str(fd, "street"), number: str(fd, "number"), district: str(fd, "district"), city: str(fd, "city"),
    uf: str(fd, "uf")?.toUpperCase().slice(0, 2) ?? null, specialties: str(fd, "specialties"), brands: str(fd, "brands"),
    paymentTerms, leadTimeDays: int(fd, "leadTimeDays"), rating, notes: str(fd, "notes"),
  } as const;
}

export async function saveSupplier(_: ActionState, fd: FormData): Promise<ActionState> {
  let createdId = "";
  const r = await run(async () => {
    const user = await assertUser("fornecedores:editar");
    const id = str(fd, "id");
    const data = parse(fd);
    await db.$transaction(async (tx) => {
      if (id) {
        const before = await tx.supplier.findUniqueOrThrow({ where: { id } });
        const d = diff(before as unknown as Record<string, unknown>, { ...data, active: bool(fd, "active") });
        await tx.supplier.update({ where: { id }, data: { ...data, active: bool(fd, "active") } });
        await audit({ action: "UPDATE", entity: "Supplier", entityId: id, userId: user.id, userName: user.name, before: d.before, after: d.after }, tx);
      } else {
        const s = await tx.supplier.create({ data });
        await audit({ action: "CREATE", entity: "Supplier", entityId: s.id, userId: user.id, userName: user.name, after: data }, tx);
        createdId = s.id;
      }
    });
    if (id) revalidatePath(`/fornecedores/${id}`);
    return "Fornecedor salvo.";
  });
  if (createdId) redirect(`/fornecedores/${createdId}`);
  return r;
}
