import "server-only";
import { randomBytes } from "crypto";
import type { FiscalDocument, FiscalSettings, FiscalStatus, Prisma } from "@prisma/client";
import { db } from "./db";
import type { SessionUser } from "./auth";
import { audit } from "./audit";
import { RuleError } from "./workflow";
import { PART_ACTIVE } from "./wo";
import { formatPlate, onlyDigits } from "./validators";
import { buildNfePayload, buildNfsePayload, type FiscalCustomer, type NfeLine, type NfseLine } from "./fiscal-payload";
import { focusRequest, parseFocusResponse, focusFileUrl } from "./focus";

// Emissão de NFS-e (serviços) e NF-e (produtos) a partir da OS, via provedor (Focus NFe).
// Fluxo: prévia (RASCUNHO, payload gravado) → transmissão (PROCESSANDO) → consulta (AUTORIZADA / REJEITADA) → cancelamento.
// Sem token configurado, o sistema gera e valida a prévia, mas não transmite.

export const FISCAL_STATUS_LABEL: Record<FiscalStatus, string> = {
  RASCUNHO: "Prévia (não transmitida)", PROCESSANDO: "Processando", AUTORIZADA: "Autorizada", REJEITADA: "Rejeitada", CANCELADA: "Cancelada", ERRO: "Erro de comunicação",
};

type Env = "HOMOLOGACAO" | "PRODUCAO";
const TOKEN_VAR: Record<Env, string> = { HOMOLOGACAO: "FISCAL_TOKEN_HOMOLOGACAO", PRODUCAO: "FISCAL_TOKEN_PRODUCAO" };
export const providerStatus = () => ({ HOMOLOGACAO: !!process.env[TOKEN_VAR.HOMOLOGACAO], PRODUCAO: !!process.env[TOKEN_VAR.PRODUCAO] });
const tokenFor = (env: string) => process.env[TOKEN_VAR[env as Env]] ?? null;

async function loadWO(woId: string) {
  return db.workOrder.findUniqueOrThrow({
    where: { id: woId },
    include: {
      customer: true, vehicle: true,
      services: { where: { status: { not: "CANCELADO" } }, orderBy: { createdAt: "asc" } },
      parts: { where: { status: { in: PART_ACTIVE } }, include: { inventoryItem: true }, orderBy: { createdAt: "asc" } },
      estimates: { include: { versions: { select: { snapshot: true } } } },
    },
  });
}
type WOFull = Awaited<ReturnType<typeof loadWO>>;

/** Código IBGE do município do cliente pelo CEP (ViaCEP). */
async function ibgeFromCep(cep?: string | null): Promise<string | null> {
  const d = onlyDigits(cep ?? "");
  if (d.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`, { signal: AbortSignal.timeout(4000) });
    const j = (await r.json()) as { ibge?: string; erro?: boolean };
    return j.erro ? null : j.ibge ?? null;
  } catch { return null; }
}

function customerOf(wo: WOFull, ibge: string | null): FiscalCustomer {
  const c = wo.customer;
  return {
    type: c.type, document: c.document, name: c.name, email: c.email, phone: c.whatsapp ?? c.phone, ie: c.type === "PJ" ? c.rgIe : null,
    cep: c.cep, street: c.street, number: c.number, complement: c.complement, district: c.district, city: c.city, uf: c.uf, ibge,
  };
}

/** Itens de serviço da OS (aprovados) para a NFS-e. */
function nfseLines(wo: WOFull): NfseLine[] {
  return wo.services.map((s) => ({ description: s.description, total: s.price }));
}

/** Itens de produto da OS (aprovados) para a NF-e — usa o cadastro fiscal do produto. */
function nfeLines(wo: WOFull, s: FiscalSettings): NfeLine[] {
  return wo.parts.filter((p) => p.type === "PECA" || p.type === "CONSUMIVEL").map((p) => {
    const inv = p.inventoryItem;
    return {
      code: inv?.sku ?? `AV-${p.id.slice(0, 8).toUpperCase()}`, description: p.description, quantity: p.quantity, unit: inv?.unit ?? "UN", total: p.price,
      ncm: inv?.ncm ?? s.defaultNcm ?? null, cest: inv?.cest ?? null, gtin: inv?.gtin ?? null, origin: inv?.origin ?? 0,
      cfop: inv?.cfop ?? s.defaultCfop, cst: inv?.cstIcms ?? null, icmsRate: inv?.icmsRate ?? null,
    };
  });
}

type Readiness = { lines: number; total: number; problems: string[]; warnings: string[] };

/** O que falta para emitir — mostrado na aba da OS antes de gerar a nota. */
export async function fiscalReadiness(woId: string): Promise<{ settings: boolean; NFSE: Readiness; NFE: Readiness }> {
  const [wo, s] = await Promise.all([loadWO(woId), db.fiscalSettings.findUnique({ where: { id: "default" } })]);
  const common: string[] = [];
  const c = wo.customer;
  if (!c.document || c.document.startsWith("SYSCAR")) common.push("Cliente sem CPF/CNPJ válido no cadastro.");
  if (!c.cep || !c.street || !c.city || !c.uf) common.push("Endereço do cliente incompleto (CEP, logradouro, cidade, UF).");
  const sv = nfseLines(wo);
  const nfse: Readiness = { lines: sv.length, total: sv.reduce((a, l) => a + l.total, 0), problems: [...common], warnings: [] };
  if (!s?.im) nfse.problems.push("Inscrição municipal do emitente não configurada.");
  if (!wo.services.length) nfse.warnings.push("A OS ainda não tem serviços aprovados.");
  if (nfse.total <= 0 && sv.length) nfse.problems.push("Valor total dos serviços é zero.");

  const pr = s ? nfeLines(wo, s) : [];
  const nfe: Readiness = { lines: pr.length, total: pr.reduce((a, l) => a + l.total, 0), problems: [...common], warnings: [] };
  if (!s?.ie) nfe.problems.push("Inscrição estadual do emitente não configurada.");
  const noNcm = pr.filter((l) => !l.ncm);
  if (noNcm.length) nfe.problems.push(`${noNcm.length} produto(s) sem NCM: ${noNcm.slice(0, 4).map((l) => l.description).join(", ")}${noNcm.length > 4 ? "…" : ""}. Cadastre o NCM no produto ou o NCM padrão do emitente.`);
  const zero = pr.filter((l) => l.total <= 0);
  if (zero.length) nfe.problems.push(`${zero.length} produto(s) com valor zero (ex.: ${zero[0].description}).`);
  const avulsos = wo.parts.filter((p) => !p.inventoryItemId && (p.type === "PECA" || p.type === "CONSUMIVEL"));
  if (avulsos.length) nfe.warnings.push(`${avulsos.length} produto(s) avulso(s), sem cadastro no estoque: usarão o NCM/CFOP padrão do emitente.`);
  if (wo.parts.some((p) => p.status === "AGUARDANDO_COMPRA")) nfe.warnings.push("Há peças aguardando compra — a nota sai com as quantidades aprovadas.");
  return { settings: !!s, NFSE: nfse, NFE: nfe };
}

async function existingOpen(woId: string, kind: "NFSE" | "NFE") {
  return db.fiscalDocument.findFirst({ where: { workOrderId: woId, kind, status: { in: ["RASCUNHO", "PROCESSANDO", "AUTORIZADA", "REJEITADA", "ERRO"] } } });
}

// A referência só aceita letras e números e nunca pode ser reutilizada depois de autorizada.
const newRef = (kind: string, number: string) => `osc${kind.toLowerCase()}${number.replace(/[^0-9A-Za-z]/g, "").toLowerCase()}${randomBytes(4).toString("hex")}`;

async function build(doc: Pick<FiscalDocument, "kind" | "workOrderId" | "rpsNumber" | "series">, s: FiscalSettings) {
  const wo = await loadWO(doc.workOrderId!);
  const customer = customerOf(wo, await ibgeFromCep(wo.customer.cep));
  const ref = `OS ${wo.number}${wo.legacyNumber && !wo.legacy ? ` (SYSCAR ${wo.legacyNumber})` : ""} · ${wo.vehicle.make} ${wo.vehicle.model} ${formatPlate(wo.vehicle.plate)}${wo.vehicle.vin ? ` ${wo.vehicle.vin}` : ""}`;
  if (doc.kind === "NFSE") {
    const lines = nfseLines(wo);
    return { lines: lines.length, total: lines.reduce((a, l) => a + l.total, 0), payload: buildNfsePayload(s, customer, lines, { reference: ref, dpsNumber: doc.rpsNumber!, series: doc.series ?? s.nfseSeries, now: new Date() }) };
  }
  const lines = nfeLines(wo, s);
  return { lines: lines.length, total: lines.reduce((a, l) => a + l.total, 0), payload: buildNfePayload(s, customer, lines, { reference: ref, now: new Date() }) };
}

async function prepare(woId: string, kind: "NFSE" | "NFE", user: SessionUser) {
  const ready = await fiscalReadiness(woId);
  if (!ready.settings) throw new RuleError("Configure o emitente fiscal primeiro.");
  const r = ready[kind];
  if (!r.lines) throw new RuleError(kind === "NFSE" ? "A OS não tem serviços aprovados para faturar." : "A OS não tem produtos aprovados para faturar.");
  const open = await existingOpen(woId, kind);
  if (open) throw new RuleError(`Já existe uma ${kind === "NFSE" ? "NFS-e" : "NF-e"} ${FISCAL_STATUS_LABEL[open.status].toLowerCase()} para esta OS.`);
  return db.$transaction(async (tx) => {
    // NFS-e: reserva o próximo número de DPS (a linha do emitente fica travada até o commit).
    // NF-e: número e série são atribuídos pelo provedor na autorização (numeração automática recomendada pela Focus).
    const s = kind === "NFSE"
      ? await tx.fiscalSettings.update({ where: { id: "default" }, data: { nfseNext: { increment: 1 } } })
      : await tx.fiscalSettings.findUniqueOrThrow({ where: { id: "default" } });
    const number = kind === "NFSE" ? s.nfseNext - 1 : null;
    const series = kind === "NFSE" ? s.nfseSeries : null;
    const wo = await tx.workOrder.findUniqueOrThrow({ where: { id: woId } });
    const built = await build({ kind, workOrderId: woId, rpsNumber: number, series }, s);
    const doc = await tx.fiscalDocument.create({
      data: {
        kind, environment: s.environment, ref: newRef(kind, wo.number), status: "RASCUNHO", workOrderId: woId, customerId: wo.customerId,
        series, rpsNumber: number, total: built.total, payload: built.payload as Prisma.InputJsonValue, createdById: user.id, createdByName: user.name,
        message: r.problems.length ? r.problems.join(" ") : null,
      },
    });
    await audit({ action: "CREATE", entity: "FiscalDocument", entityId: doc.id, userId: user.id, userName: user.name, after: { kind, number, series, total: built.total, environment: s.environment } }, tx);
    return doc;
  });
}

export const prepareNfse = (woId: string, user: SessionUser) => prepare(woId, "NFSE", user);
export const prepareNfe = (woId: string, user: SessionUser) => prepare(woId, "NFE", user);

async function save(doc: FiscalDocument, patch: Prisma.FiscalDocumentUpdateInput, user: SessionUser, action: string) {
  const updated = await db.fiscalDocument.update({ where: { id: doc.id }, data: patch });
  await audit({ action, entity: "FiscalDocument", entityId: doc.id, userId: user.id, userName: user.name, before: { status: doc.status }, after: { status: updated.status, number: updated.number, message: updated.message } });
  return updated;
}

/** Transmite (ou retransmite após rejeição) — o payload é refeito a partir dos cadastros atuais, mantendo ref e número. */
export async function transmit(id: string, user: SessionUser) {
  const doc = await db.fiscalDocument.findUniqueOrThrow({ where: { id } });
  if (!["RASCUNHO", "REJEITADA", "ERRO"].includes(doc.status)) throw new RuleError("Esta nota já foi transmitida.");
  const s = await db.fiscalSettings.findUniqueOrThrow({ where: { id: "default" } });
  if (s.environment !== doc.environment) throw new RuleError(`A prévia foi gerada em ${doc.environment.toLowerCase()} e o emitente agora está em ${s.environment.toLowerCase()}. Descarte e gere outra.`);
  const ready = (await fiscalReadiness(doc.workOrderId!))[doc.kind];
  if (ready.problems.length) throw new RuleError(`Corrija antes de transmitir: ${ready.problems.join(" ")}`);
  const built = await build(doc, s);
  const token = tokenFor(doc.environment);
  if (!token) {
    await save(doc, { payload: built.payload as Prisma.InputJsonValue, total: built.total, message: "Token do provedor de emissão não configurado — nota não transmitida." }, user, "FISCAL_PREVIEW");
    throw new RuleError(`Token do provedor não configurado (${TOKEN_VAR[doc.environment as Env]}). A prévia foi atualizada, mas nada foi enviado.`);
  }
  const res = await focusRequest(doc.environment as Env, token, "POST", doc.kind, doc.ref, built.payload);
  const p = parseFocusResponse(doc.kind, res);
  const sent = await save(doc, {
    payload: built.payload as Prisma.InputJsonValue, total: built.total, response: res.body as Prisma.InputJsonValue,
    status: p.status, message: p.message, number: p.number, accessKey: p.accessKey, verificationCode: p.verificationCode, protocol: p.protocol,
    xmlUrl: focusFileUrl(doc.environment as Env, p.xmlPath), pdfUrl: focusFileUrl(doc.environment as Env, p.pdfPath), issuedAt: p.status === "AUTORIZADA" ? new Date() : null,
  }, user, "FISCAL_SEND");
  if (sent.status !== "PROCESSANDO") return sent;
  // A autorização é assíncrona: uma consulta rápida costuma já trazer o resultado
  await new Promise((r) => setTimeout(r, 2500));
  return refreshStatus(sent.id, user);
}

export async function refreshStatus(id: string, user: SessionUser) {
  const doc = await db.fiscalDocument.findUniqueOrThrow({ where: { id } });
  const token = tokenFor(doc.environment);
  if (!token) throw new RuleError("Token do provedor não configurado.");
  const res = await focusRequest(doc.environment as Env, token, "GET", doc.kind, doc.ref);
  const p = parseFocusResponse(doc.kind, res);
  return save(doc, {
    response: res.body as Prisma.InputJsonValue, status: p.status, message: p.message, number: p.number ?? doc.number, accessKey: p.accessKey ?? doc.accessKey,
    verificationCode: p.verificationCode ?? doc.verificationCode, protocol: p.protocol ?? doc.protocol,
    xmlUrl: focusFileUrl(doc.environment as Env, p.xmlPath) ?? doc.xmlUrl, pdfUrl: focusFileUrl(doc.environment as Env, p.pdfPath) ?? doc.pdfUrl,
    issuedAt: p.status === "AUTORIZADA" ? doc.issuedAt ?? new Date() : doc.issuedAt,
  }, user, "FISCAL_REFRESH");
}

export async function cancelDocument(id: string, reason: string, user: SessionUser) {
  const doc = await db.fiscalDocument.findUniqueOrThrow({ where: { id } });
  if (doc.status !== "AUTORIZADA") throw new RuleError("Só notas autorizadas podem ser canceladas.");
  const r = reason.trim();
  if (r.length < 15 || r.length > 255) throw new RuleError("A justificativa deve ter entre 15 e 255 caracteres.");
  const token = tokenFor(doc.environment);
  if (!token) throw new RuleError("Token do provedor não configurado.");
  const res = await focusRequest(doc.environment as Env, token, "DELETE", doc.kind, doc.ref, { justificativa: r });
  const p = parseFocusResponse(doc.kind, res);
  const cancelled = p.status === "CANCELADA";
  return save(doc, {
    response: res.body as Prisma.InputJsonValue, status: cancelled ? "CANCELADA" : doc.status, message: cancelled ? `Cancelada: ${r}` : `Cancelamento não aceito: ${p.message ?? "sem detalhes"}`,
    cancelledAt: cancelled ? new Date() : null, cancelReason: cancelled ? r : null,
  }, user, "FISCAL_CANCEL");
}
