import { unstable_rethrow } from "next/navigation";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AuthError } from "./auth";
import { RuleError } from "./workflow";

export type ActionState = { ok?: string; error?: string; at?: number; data?: Record<string, string> } | null;

/** Executa uma server action e converte erros de regra/permissão/validação em mensagem para a tela. */
export async function run(fn: () => Promise<string | void | { message: string; data?: Record<string, string> }>): Promise<ActionState> {
  try {
    const r = await fn();
    if (r && typeof r === "object") return { ok: r.message, data: r.data, at: Date.now() };
    return { ok: r || "Salvo.", at: Date.now() };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof RuleError || e instanceof AuthError) return { error: e.message, at: Date.now() };
    if (e instanceof ZodError) return { error: e.issues.map((i) => i.message).join(" · "), at: Date.now() };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = String((e.meta?.target as string[] | undefined)?.join(", ") ?? "");
      const label = target.includes("document") ? "CPF/CNPJ" : target.includes("plate") ? "placa" : target.includes("email") ? "e-mail" : target.includes("sku") ? "SKU" : target || "campo único";
      return { error: `Já existe um registro com este ${label}.`, at: Date.now() };
    }
    console.error(e);
    return { error: "Erro inesperado. A operação não foi concluída.", at: Date.now() };
  }
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
export const req = (fd: FormData, k: string, label: string) => {
  const v = str(fd, k);
  if (!v) throw new RuleError(`Preencha: ${label}.`);
  return v;
};
export const int = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (v === null) return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : null;
};
export const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (v === null) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
