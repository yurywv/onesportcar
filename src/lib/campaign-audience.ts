import type { CampaignChannel, Prisma } from "@prisma/client";
import { db } from "./db";
import { addressFor, varsFor } from "./campaigns";

export type AudienceFilter = {
  q?: string;
  tipo?: string; // PF | PJ
  cidade?: string;
  marca?: string;
  modelo?: string;
  ativoMeses?: string; // teve OS nos últimos N meses
  sumidoMeses?: string; // sem OS há pelo menos N meses (mas já foi cliente)
  base?: string; // "consentidos" (padrão) | "clientes" (todos que não se descadastraram)
};

export const FILTER_KEYS: (keyof AudienceFilter)[] = ["q", "tipo", "cidade", "marca", "modelo", "ativoMeses", "sumidoMeses", "base"];

const monthsAgo = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
};

export function audienceWhere(channel: CampaignChannel, f: AudienceFilter): Prisma.CustomerWhereInput {
  const and: Prisma.CustomerWhereInput[] = [{ active: true }, { marketingOptOutAt: null }];
  if (channel === "EMAIL") and.push({ email: { contains: "@" } });
  else and.push({ OR: [{ whatsapp: { not: null } }, { phone: { not: null } }] });
  if (f.base !== "clientes") and.push({ consentMarketing: true });
  if (f.q) and.push({ name: { contains: f.q, mode: "insensitive" } });
  if (f.tipo === "PF" || f.tipo === "PJ") and.push({ type: f.tipo });
  if (f.cidade) and.push({ city: { contains: f.cidade, mode: "insensitive" } });
  if (f.marca || f.modelo) {
    and.push({
      vehicles: {
        some: {
          active: true,
          ...(f.marca ? { make: { contains: f.marca, mode: "insensitive" } } : {}),
          ...(f.modelo ? { model: { contains: f.modelo, mode: "insensitive" } } : {}),
        },
      },
    });
  }
  const ativo = Number(f.ativoMeses);
  if (ativo > 0) and.push({ workOrders: { some: { openedAt: { gte: monthsAgo(ativo) } } } });
  const sumido = Number(f.sumidoMeses);
  if (sumido > 0) and.push({ workOrders: { some: {} } }, { workOrders: { none: { openedAt: { gte: monthsAgo(sumido) } } } });
  return { AND: and };
}

/** Inclui clientes na campanha (ignora quem já está nela ou não tem contato válido). */
export async function addCustomersToCampaign(campaignId: string, channel: CampaignChannel, ids: string[], f: AudienceFilter) {
  if (!ids.length) return { added: 0, invalid: 0 };
  const customers = await db.customer.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, name: true, type: true, tradeName: true, email: true, whatsapp: true, phone: true, marketingOptOutAt: true, marketingToken: true,
      vehicles: {
        where: {
          active: true,
          ...(f.marca ? { make: { contains: f.marca, mode: "insensitive" } } : {}),
          ...(f.modelo ? { model: { contains: f.modelo, mode: "insensitive" } } : {}),
        },
        select: { make: true, model: true, plate: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  const missing = customers.filter((c) => !c.marketingToken).map((c) => c.id);
  if (missing.length)
    await db.$executeRaw`UPDATE "Customer" SET "marketingToken" = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') WHERE "marketingToken" IS NULL AND id = ANY(${missing})`;
  let invalid = 0;
  const rows: Prisma.CampaignRecipientCreateManyInput[] = [];
  for (const c of customers) {
    const address = c.marketingOptOutAt ? null : addressFor(channel, c);
    if (!address) { invalid++; continue; }
    rows.push({ campaignId, customerId: c.id, name: c.name, address, vars: varsFor(c, c.vehicles[0]) });
  }
  const r = await db.campaignRecipient.createMany({ data: rows, skipDuplicates: true });
  return { added: r.count, invalid };
}
