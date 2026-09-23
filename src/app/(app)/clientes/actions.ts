"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { assertUser, requestMeta } from "@/lib/auth";
import { audit, diff } from "@/lib/audit";
import { run, str, req, bool, type ActionState } from "@/lib/action";
import { RuleError } from "@/lib/workflow";
import { isValidCPF, isValidCNPJ, isValidEmail, normalizeDocument, onlyDigits } from "@/lib/validators";

function parse(fd: FormData) {
  const type = fd.get("type") === "PJ" ? "PJ" : "PF";
  const document = normalizeDocument(type, req(fd, "document", type === "PF" ? "CPF" : "CNPJ"));
  if (type === "PF" && !isValidCPF(document)) throw new RuleError("CPF inválido.");
  if (type === "PJ" && !isValidCNPJ(document)) throw new RuleError("CNPJ inválido (numérico ou alfanumérico).");
  const email = str(fd, "email")?.toLowerCase() ?? null;
  if (email && !isValidEmail(email)) throw new RuleError("E-mail inválido.");
  const phone = str(fd, "phone"), whatsapp = str(fd, "whatsapp");
  if (!phone && !whatsapp && !email) throw new RuleError("Informe ao menos um contato (telefone, WhatsApp ou e-mail).");
  const birth = str(fd, "birthDate");
  const consent = bool(fd, "consentMarketing");
  return {
    type, document, email, phone, whatsapp,
    name: req(fd, "name", type === "PF" ? "Nome" : "Razão social"),
    tradeName: str(fd, "tradeName"), rgIe: str(fd, "rgIe"),
    birthDate: birth ? new Date(`${birth}T12:00:00Z`) : null,
    cep: str(fd, "cep"), street: str(fd, "street"), number: str(fd, "number"), complement: str(fd, "complement"),
    district: str(fd, "district"), city: str(fd, "city"), uf: str(fd, "uf")?.toUpperCase().slice(0, 2) ?? null,
    origin: str(fd, "origin"), notes: str(fd, "notes"), preferredChannel: str(fd, "preferredChannel"),
    consentMarketing: consent,
  } as const;
}

/** Duplicidade: CPF/CNPJ bloqueia (unique no banco); telefone/e-mail alertam. */
async function duplicateWarning(data: { phone: string | null; whatsapp: string | null; email: string | null }, exceptId?: string) {
  const phones = [data.phone, data.whatsapp].filter(Boolean).map((p) => onlyDigits(p!));
  const or = [
    ...(data.email ? [{ email: data.email }] : []),
    ...phones.flatMap((p) => [{ phone: { contains: p.slice(-8) } }, { whatsapp: { contains: p.slice(-8) } }]),
  ];
  if (!or.length) return null;
  const dup = await db.customer.findFirst({ where: { OR: or, NOT: exceptId ? { id: exceptId } : undefined } });
  return dup ? `Atenção: telefone ou e-mail já usado por "${dup.name}". Verifique se não é duplicidade.` : null;
}

export async function createCustomer(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await run(async () => {
    const user = await assertUser("clientes:editar");
    const data = parse(fd);
    const warn = await duplicateWarning(data);
    if (warn && fd.get("confirmDuplicate") !== "1") throw new RuleError(`${warn} Marque "confirmo que não é duplicado" para salvar.`);
    const c = await db.$transaction(async (tx) => {
      const c = await tx.customer.create({ data: { ...data, consentAt: data.consentMarketing ? new Date() : null } });
      await audit({ action: "CREATE", entity: "Customer", entityId: c.id, userId: user.id, userName: user.name, after: { ...data, document: "***" }, ...(await requestMeta()) }, tx);
      return c;
    });
    id = c.id;
  });
  if (id) redirect(`/clientes/${id}`);
  return r;
}

export async function updateCustomer(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await assertUser("clientes:editar");
    const id = String(fd.get("id"));
    const before = await db.customer.findUniqueOrThrow({ where: { id } });
    const data = parse(fd);
    const d = diff(before as unknown as Record<string, unknown>, data);
    if (!d.changed && before.active === bool(fd, "active")) return "Nenhuma alteração.";
    await db.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id },
        data: { ...data, active: bool(fd, "active"), consentAt: data.consentMarketing && !before.consentMarketing ? new Date() : data.consentMarketing ? before.consentAt : null },
      });
      await audit({ action: "UPDATE", entity: "Customer", entityId: id, userId: user.id, userName: user.name, before: d.before, after: { ...d.after, active: bool(fd, "active") }, ...(await requestMeta()) }, tx);
    });
    revalidatePath(`/clientes/${id}`);
    const warn = await duplicateWarning(data, id);
    return warn ? `Salvo. ${warn}` : "Cliente atualizado.";
  });
}
