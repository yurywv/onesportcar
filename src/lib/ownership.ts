import { createHash } from "crypto";
import type { Tx } from "./db";

// Proprietários de veículos vindos do SYSCAR.
// O relatório "Veículos com Proprietário" traz só nome/telefone do dono; as OS trazem o cliente da época.
// Com isso o sistema (1) liga o veículo ao dono atual, (2) mantém cada OS com o cliente que a fez e
// (3) reconstrói os períodos de cada dono (VehicleOwnership) a partir da sequência de OS.

/** Nome comparável: sem acento, maiúsculo, sem pontuação e espaços repetidos. */
export const normName = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const phone8 = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-8);

/** Documento provisório determinístico para dono sem CPF/CNPJ no SYSCAR (o mesmo nome+telefone gera o mesmo cadastro). */
export const provisionalDocument = (name: string, phone?: string | null) =>
  `SYSCAR-${createHash("sha256").update(`${normName(name)}|${phone8(phone)}`).digest("hex").slice(0, 10).toUpperCase()}`;
export const isProvisional = (document: string) => document.startsWith("SYSCAR-");

export type OwnerMatch = { id: string; name: string } | { ambiguous: number } | null;

/** Localiza o cliente pelo nome (ignorando acentos/caixa); o telefone desempata homônimos. */
export async function findCustomerByName(tx: Tx, name: string, phone?: string | null): Promise<OwnerMatch> {
  const target = normName(name);
  if (!target) return null;
  // Comparação sem acento/pontuação feita no próprio banco (sem depender da extensão unaccent)
  const ids = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Customer"
    WHERE btrim(regexp_replace(translate(upper(name), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNAAAAAEEEEIIIIOOOOOUUUUCN'), '[^A-Z0-9]+', ' ', 'g')) = ${target}
    LIMIT 50`;
  const cands = ids.length ? (await tx.customer.findMany({ where: { id: { in: ids.map((x) => x.id) } }, select: { id: true, name: true, phone: true, whatsapp: true, document: true } })).filter((c) => normName(c.name) === target) : [];
  // Cadastro real tem preferência sobre o provisório
  const real = cands.filter((c) => !isProvisional(c.document));
  const pool = real.length ? real : cands;
  if (pool.length === 1) return pool[0];
  const p = phone8(phone);
  if (pool.length > 1 && p) {
    const byPhone = pool.filter((c) => [c.phone, c.whatsapp].some((x) => phone8(x) === p));
    if (byPhone.length === 1) return byPhone[0];
  }
  return pool.length > 1 ? { ambiguous: pool.length } : null;
}

/** Cria (ou reaproveita) o cadastro provisório de um dono sem CPF/CNPJ. */
export async function ensureProvisionalCustomer(tx: Tx, name: string, phone?: string | null) {
  const document = provisionalDocument(name, phone);
  const digits = (phone ?? "").replace(/\D/g, "");
  return tx.customer.upsert({
    where: { document },
    update: {},
    create: {
      type: "PF", document, name: name.trim().slice(0, 200), origin: "SYSCAR_PROVISORIO",
      whatsapp: digits.length >= 10 ? phone : null, phone: digits.length >= 8 && digits.length < 10 ? phone : null,
      notes: "Cadastro provisório criado na importação do SYSCAR (sem CPF/CNPJ). Complete o documento quando o cliente voltar.",
    },
  });
}

type Seg = { customerId: string; first: Date; last: Date };

/** Agrupa a sequência de clientes das OS em períodos. Quem aparece só entre dois atendimentos do mesmo dono
 *  (A, B, A) é tratado como quem trouxe/pagou o carro, não como novo dono. */
export function ownershipSegments(events: { at: Date; customerId: string }[], currentOwnerId: string): Seg[] {
  const segs: Seg[] = [];
  for (const e of [...events].sort((a, b) => +a.at - +b.at)) {
    const last = segs.at(-1);
    if (last && last.customerId === e.customerId) last.last = e.at;
    else segs.push({ customerId: e.customerId, first: e.at, last: e.at });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < segs.length - 1; i++) {
      if (segs[i - 1].customerId === segs[i + 1].customerId) {
        segs[i - 1].last = segs[i + 1].last;
        segs.splice(i, 2);
        changed = true;
        break;
      }
    }
  }
  // O dono atual (cadastro do veículo) fecha a linha do tempo
  const tail = segs.at(-1);
  if (!tail) return [];
  if (tail.customerId !== currentOwnerId) {
    // Se o dono atual já apareceu antes, quem veio depois dele só trouxe o carro
    const idx = segs.findIndex((s) => s.customerId === currentOwnerId);
    if (idx >= 0) { segs[idx].last = tail.last; segs.splice(idx + 1); }
    else segs.push({ customerId: currentOwnerId, first: new Date(+tail.last + 1000), last: tail.last });
  }
  return segs;
}

/** Recalcula os períodos de proprietário do veículo a partir das OS. Não mexe em trocas feitas no próprio sistema. */
export async function rebuildOwnership(tx: Tx, vehicleId: string) {
  const v = await tx.vehicle.findUniqueOrThrow({ where: { id: vehicleId }, select: { id: true, customerId: true, createdAt: true } });
  const manual = await tx.vehicleOwnership.findMany({ where: { vehicleId, source: "SISTEMA" }, orderBy: { startedAt: "asc" } });
  const cutoff = manual[0]?.startedAt;
  let wos = await tx.workOrder.findMany({ where: { vehicleId, status: { not: "CANCELADA" }, ...(cutoff ? { openedAt: { lt: cutoff } } : {}) }, select: { openedAt: true, customerId: true } });
  if (!wos.length) wos = await tx.workOrder.findMany({ where: { vehicleId, ...(cutoff ? { openedAt: { lt: cutoff } } : {}) }, select: { openedAt: true, customerId: true } });
  const ownerAtCutoff = manual[0]?.customerId ?? v.customerId;
  const segs = ownershipSegments(wos.map((w) => ({ at: w.openedAt, customerId: w.customerId })), ownerAtCutoff);
  let end: Date | null = null;
  if (manual.length) {
    // O último período deduzido é o mesmo dono do primeiro vínculo feito no sistema: estende esse vínculo para trás.
    const tail = segs.pop();
    end = cutoff!;
    if (tail && tail.first < cutoff!) {
      await tx.vehicleOwnership.update({ where: { id: manual[0].id }, data: { startedAt: tail.first } });
      end = tail.first;
    }
  }
  await tx.vehicleOwnership.deleteMany({ where: { vehicleId, source: { in: ["IMPORTACAO", "HISTORICO_OS"] } } });
  if (!segs.length && !manual.length) {
    await tx.vehicleOwnership.create({ data: { vehicleId, customerId: v.customerId, startedAt: v.createdAt, source: "IMPORTACAO" } });
    return { owners: 1 };
  }
  const data = segs.map((s, i) => ({
    vehicleId, customerId: s.customerId, startedAt: s.first, source: "HISTORICO_OS",
    endedAt: i < segs.length - 1 ? segs[i + 1].first : end,
  }));
  if (data.length) await tx.vehicleOwnership.createMany({ data });
  return { owners: data.length + manual.length };
}
