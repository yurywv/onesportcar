/* Dados FICTÍCIOS para demonstração (spec §18). Nenhum dado pessoal real.
   Bloqueado em produção, a menos que ALLOW_DEMO_SEED=1 seja definido explicitamente. */
import { PrismaClient, type Role, type ItemType, type ItemClass } from "@prisma/client";
import bcrypt from "bcryptjs";
import { sendEstimate, recordDecisions } from "../src/lib/estimate";
import { transition } from "../src/lib/workflow";
import { stockEntry, applyPart } from "../src/lib/inventory";
import { startTimer, stopTimer } from "../src/lib/wo";
import { nextNumber } from "../src/lib/sequence";
import type { SessionUser } from "../src/lib/auth";

const db = new PrismaClient();

if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "1") {
  console.error("Seed de demonstração bloqueado em produção. Defina ALLOW_DEMO_SEED=1 para um ambiente de demonstração.");
  process.exit(1);
}
const PASSWORD = process.env.SEED_PASSWORD;
if (!PASSWORD || PASSWORD.length < 10) {
  console.error("Defina SEED_PASSWORD (mín. 10 caracteres) — senha inicial dos usuários de demonstração.");
  process.exit(1);
}

let rnd = 42;
const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 10)).join("");

function cpf() {
  const b = digits(9);
  const dv = (s: string) => { let sum = 0; for (let i = 0; i < s.length; i++) sum += Number(s[i]) * (s.length + 1 - i); const r = (sum * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(b); const d2 = dv(b + d1);
  return b + d1 + d2;
}
function cnpj() {
  const b = digits(8) + "0001";
  const dv = (s: string) => { let w = 2, sum = 0; for (let i = s.length - 1; i >= 0; i--) { sum += Number(s[i]) * w; w = w === 9 ? 2 : w + 1; } const r = sum % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(b); const d2 = dv(b + d1);
  return b + d1 + d2;
}

async function main() {
  const existing = await db.user.count();
  if (existing) { console.log("Banco já possui dados — seed ignorado."); return; }

  const company = await db.company.create({ data: { name: "DBL Automotiva Ltda. (demonstração)", document: cnpj() } });
  const branch = await db.branch.create({ data: { companyId: company.id, code: "MTZ", name: "OneSportcar — Matriz" } });

  const hash = await bcrypt.hash(PASSWORD!, 12);
  const people: [string, string, Role, Partial<{ specialties: string; level: string; hourlyRate: number; hourlyCost: number }>?][] = [
    ["Administrador Demo", "admin@onesportcar.demo", "ADMIN"],
    ["Gestora Demo", "gestor@onesportcar.demo", "GESTOR"],
    ["Consultor Rafael Demo", "consultor@onesportcar.demo", "CONSULTOR"],
    ["Técnico Bruno Demo", "tecnico@onesportcar.demo", "TECNICO", { specialties: "Motor, diagnóstico eletrônico, alta tensão", level: "Master", hourlyRate: 42000, hourlyCost: 12000 }],
    ["Técnica Carla Demo", "tecnico2@onesportcar.demo", "TECNICO", { specialties: "Freios, suspensão, transmissão", level: "Sênior", hourlyRate: 38000, hourlyCost: 10000 }],
    ["Estoquista Demo", "estoque@onesportcar.demo", "ESTOQUISTA"],
    ["Financeiro Demo", "financeiro@onesportcar.demo", "FINANCEIRO"],
    ["Auditor Demo", "auditor@onesportcar.demo", "AUDITOR"],
  ];
  const users: Record<string, SessionUser> = {};
  for (const [name, email, role, extra] of people) {
    const u = await db.user.create({ data: { name, email, role, passwordHash: hash, branchId: branch.id, ...extra } });
    users[email.split("@")[0]] = { id: u.id, name, email, role, branchId: branch.id };
  }
  const consultor = users.consultor, tec = users.tecnico, tec2 = users.tecnico2, gestor = users.gestor, estoque = users.estoque;

  for (const [code, description] of [["B01", "Elevador 4 colunas — alinhamento"], ["B02", "Elevador 2 colunas"], ["B03", "Elevador 2 colunas"], ["B04", "Box diagnóstico / alta tensão"], ["B05", "Preparação e lavagem"]])
    await db.workshopBay.create({ data: { branchId: branch.id, code, description } });

  const services = [
    ["REV-01", "Revisão periódica completa", "Revisão", 180, 42000],
    ["DIAG-01", "Diagnóstico eletrônico", "Diagnóstico", 60, 45000],
    ["FRE-01", "Substituição de pastilhas dianteiras", "Freios", 90, 38000],
    ["FRE-02", "Substituição de discos e pastilhas dianteiros", "Freios", 150, 38000],
    ["OLE-01", "Troca de óleo e filtro", "Lubrificação", 45, 38000],
    ["SUS-01", "Substituição de amortecedores dianteiros", "Suspensão", 240, 40000],
    ["ALI-01", "Alinhamento e balanceamento", "Pneus", 60, 30000],
    ["AC-01", "Higienização e carga do ar-condicionado", "Ar-condicionado", 90, 32000],
    ["HV-01", "Inspeção de bateria de alta tensão", "Alta tensão", 120, 48000],
  ] as const;
  const svc: Record<string, string> = {};
  for (const [code, name, category, standardMin, hourlyRate] of services) {
    const s = await db.serviceCatalog.create({ data: { code, name, category, standardMin, hourlyRate } });
    svc[code] = s.id;
  }

  const items = [
    ["OL-0W40-1L", "Óleo sintético 0W-40 (1 L)", "OLEOS", "L", 8900, 16500, 40, 12],
    ["FO-911-992", "Filtro de óleo — aplicação 911 (992)", "FILTROS", "UN", 21000, 39000, 6, 3],
    ["FA-CAB-01", "Filtro de cabine carvão ativado", "FILTROS", "UN", 18000, 34000, 4, 2],
    ["PF-DIA-CER", "Jogo de pastilhas dianteiras cerâmicas", "PECAS", "JG", 210000, 385000, 2, 1],
    ["DF-DIA-380", "Disco de freio dianteiro 380 mm", "PECAS", "UN", 320000, 560000, 0, 2],
    ["SEN-DESG", "Sensor de desgaste de pastilha", "PECAS", "UN", 18000, 36000, 5, 2],
    ["FLU-DOT4", "Fluido de freio DOT 4 (1 L)", "FLUIDOS", "L", 9000, 18000, 10, 4],
    ["AMO-DIA", "Amortecedor dianteiro adaptativo", "PECAS", "UN", 640000, 1090000, 0, 0],
    ["PN-2453520", "Pneu 245/35 R20 alta performance", "PNEUS", "UN", 290000, 460000, 8, 4],
    ["QUI-LIMP-FR", "Limpa-freios aerossol", "CONSUMIVEIS", "UN", 2800, 0, 24, 10],
  ] as const;
  const inv: Record<string, string> = {};
  for (const [sku, name, category, unit, cost, price, qty, min] of items) {
    const it = await db.inventoryItem.create({ data: { sku, name, category, unit, price, minQty: min, location: "Almox. A" } });
    inv[sku] = it.id;
    if (qty > 0) await db.$transaction((tx) => stockEntry(tx, estoque, it.id, qty, cost, "Saldo inicial (demo)"));
  }

  const vehiclesData = [
    ["Porsche", "911", "Carrera S (992)", 2022, "Cinza Giz", "GASOLINA", "BRA2E19", 18450],
    ["Porsche", "Taycan", "4S", 2023, "Azul Genciana", "ELETRICO", "FTR4A21", 21300],
    ["BMW", "M3", "Competition", 2021, "Verde Isle of Man", "GASOLINA", "QWE1J23", 35100],
    ["Mercedes-AMG", "GT", "63 S 4MATIC+", 2022, "Preto Obsidiana", "GASOLINA", "AMG6S30", 12800],
    ["Audi", "RS6", "Avant Performance", 2023, "Cinza Nardo", "GASOLINA", "RSS6A11", 9800],
    ["Land Rover", "Range Rover", "Autobiography P530", 2023, "Branco Fuji", "GASOLINA", "LRA5R30", 27600],
    ["Ferrari", "296", "GTB", 2023, "Rosso Corsa", "HIBRIDO_PLUGIN", "FER2G96", 6400],
    ["Lamborghini", "Urus", "Performante", 2023, "Amarelo Giallo", "GASOLINA", "URU5P23", 15200],
  ] as const;
  const first = ["Ricardo", "Helena", "Marcos", "Patrícia", "Eduardo", "Camila", "Gustavo", "Beatriz"];
  const last = ["Almeida Teste", "Monteiro Teste", "Siqueira Teste", "Vasconcelos Teste", "Prado Teste", "Rezende Teste", "Lacerda Teste", "Fontes Teste"];
  const vehicles: { id: string; customerId: string; mileage: number }[] = [];
  for (let i = 0; i < vehiclesData.length; i++) {
    const isPJ = i === 5;
    const c = await db.customer.create({
      data: {
        type: isPJ ? "PJ" : "PF",
        name: isPJ ? "Holding Exemplo Participações Ltda. (fictícia)" : `${first[i]} ${last[i]}`,
        tradeName: isPJ ? "Holding Exemplo" : null,
        document: isPJ ? cnpj() : cpf(),
        phone: `(11) 9${digits(4)}-${digits(4)}`,
        whatsapp: `(11) 9${digits(4)}-${digits(4)}`,
        email: `cliente${i + 1}@exemplo.test`,
        cep: "01310-100", street: "Av. Exemplo", number: String(100 + i * 10), district: "Centro", city: "São Paulo", uf: "SP",
        origin: ["Indicação", "Instagram", "Concessionária", "Google"][i % 4], preferredChannel: "WHATSAPP",
        consentMarketing: i % 2 === 0, consentAt: i % 2 === 0 ? new Date() : null,
      },
    });
    const [make, model, version, year, color, propulsion, plate, mileage] = vehiclesData[i];
    const v = await db.vehicle.create({
      data: { customerId: c.id, make, model, version, yearMfg: year, yearModel: year, color, propulsion, plate, mileage, transmission: "Automática" },
    });
    await db.vehicleOwnership.create({ data: { vehicleId: v.id, customerId: c.id } });
    await db.odometerReading.create({ data: { vehicleId: v.id, km: mileage, source: "MANUAL" } });
    vehicles.push({ id: v.id, customerId: c.id, mileage });
  }

  const bays = await db.workshopBay.findMany({ orderBy: { code: "asc" } });

  // ── OS percorrendo o fluxo real através das regras de domínio ──
  async function openWO(vi: number, complaint: string, techId: string | null, dayOffset = 0) {
    return db.$transaction(async (tx) => {
      const v = vehicles[vi];
      const number = await nextNumber(tx, branch.id, "OS");
      const wo = await tx.workOrder.create({
        data: {
          number, branchId: branch.id, customerId: v.customerId, vehicleId: v.id, consultantId: consultor.id, technicianId: techId,
          bayId: bays[vi % 4].id, complaint, status: "CHECK_IN", createdById: consultor.id,
          openedAt: new Date(Date.now() - dayOffset * 86400_000), promisedAt: new Date(Date.now() + (2 - dayOffset) * 86400_000),
        },
      });
      await tx.workOrderStatusHistory.create({ data: { workOrderId: wo.id, toStatus: "CHECK_IN", userId: consultor.id, userName: consultor.name, reason: "Check-in iniciado" } });
      const km = v.mileage + 120;
      await tx.checkIn.create({
        data: {
          number: await nextNumber(tx, branch.id, "CHK"), workOrderId: wo.id, km, fuelLevel: 60, range: 280, broughtBy: "Titular (fictício)",
          broughtByRelation: "TITULAR", arrivalMode: "RODANDO", dashLights: [], keysCount: 2, hasManual: true, hasDocuments: true,
          conditions: { Pneus: "OK", Rodas: "Riscos leves", Vidros: "OK", Faróis: "OK", Lanternas: "OK", "Para-brisa": "OK" },
          signedName: "Titular (fictício)", signatureData: null, signedAt: new Date(), contentHash: "seed", locked: true, createdById: consultor.id,
          damages: { create: [{ view: "TOPO", x: 0.18, y: 0.3, type: "RISCO", severity: "LEVE", note: "Risco no para-choque dianteiro esquerdo" }] },
        },
      });
      await tx.vehicle.update({ where: { id: v.id }, data: { mileage: km } });
      await tx.odometerReading.create({ data: { vehicleId: v.id, km, source: "CHECKIN", workOrderId: wo.id } });
      await transition(tx, wo.id, "AGUARDANDO_DIAGNOSTICO", consultor, { reason: "Check-in assinado" });
      return wo;
    });
  }
  async function diagnose(woId: string, t: SessionUser, diagnosis: string) {
    await db.$transaction(async (tx) => {
      await transition(tx, woId, "EM_DIAGNOSTICO", t);
      await tx.diagnostic.create({ data: { workOrderId: woId, technicianId: t.id, technicianName: t.name, diagnosis, tests: "Leitura de módulos, inspeção visual, teste de rodagem curto", faultCodes: "Nenhum código ativo", finishedAt: new Date() } });
      await transition(tx, woId, "ORCAMENTO", t);
    });
  }
  async function estimate(woId: string, lines: { type: ItemType; cls?: ItemClass; desc: string; qty?: number; min?: number; price: number; cost?: number; inv?: string; svc?: string; discount?: number }[], kind = "INICIAL") {
    return db.$transaction(async (tx) => {
      const est = await tx.estimate.create({ data: { number: await nextNumber(tx, branch.id, "ORC"), workOrderId: woId, kind, createdById: consultor.id, validUntil: new Date(Date.now() + 7 * 86400_000) } });
      let i = 0;
      for (const l of lines)
        await tx.estimateItem.create({ data: { estimateId: est.id, type: l.type, classification: l.cls ?? "OBRIGATORIO", description: l.desc, quantity: l.qty ?? 1, minutes: l.min, unitPrice: l.price, unitCost: l.cost ?? 0, inventoryItemId: l.inv ? inv[l.inv] : null, serviceId: l.svc ? svc[l.svc] : null, discount: l.discount ?? 0, sortOrder: i++ } });
      const { version } = await sendEstimate(tx, est.id, consultor);
      return version;
    });
  }
  async function approveAll(versionId: string, refuse: number[] = []) {
    const v = await db.estimateVersion.findUniqueOrThrow({ where: { id: versionId } });
    const snap = v.snapshot as { items: { id: string }[] };
    await db.$transaction((tx) => recordDecisions(tx, versionId, snap.items.map((it, i) => ({ itemId: it.id, decision: refuse.includes(i) ? "RECUSADO" : "APROVADO" })), { channel: "PRESENCIAL", approverName: "Titular (fictício)", removedPartsDestination: "DEVOLVER" }, consultor));
  }
  async function execute(woId: string, t: SessionUser) {
    const wo = await db.workOrder.findUniqueOrThrow({ where: { id: woId }, include: { services: true, parts: true } });
    for (const p of wo.parts.filter((p) => p.status === "RESERVADA")) await db.$transaction((tx) => applyPart(tx, t, p.id));
    for (const s of wo.services) {
      await db.$transaction((tx) => startTimer(tx, t, s.id));
      await db.$transaction((tx) => stopTimer(tx, t, s.id, "FINALIZADO"));
    }
  }

  const freios = [
    { type: "SERVICO" as const, desc: "Substituição de pastilhas dianteiras", min: 90, price: 57000, svc: "FRE-01" },
    { type: "PECA" as const, desc: "Jogo de pastilhas dianteiras cerâmicas", price: 385000, cost: 210000, inv: "PF-DIA-CER" },
    { type: "PECA" as const, desc: "Sensor de desgaste de pastilha", price: 36000, cost: 18000, inv: "SEN-DESG" },
    { type: "PECA" as const, cls: "RECOMENDADO" as const, desc: "Fluido de freio DOT 4", qty: 1, price: 18000, cost: 9000, inv: "FLU-DOT4" },
  ];

  // 1) Entregue: revisão completa, pagamento e check-out
  const w1 = await openWO(0, "Revisão dos 20.000 km. Cliente relata leve ruído ao frear em baixa velocidade.", tec.id, 3);
  await diagnose(w1.id, tec, "Pastilhas dianteiras com 3 mm; demais itens da revisão dentro do especificado.");
  const v1 = await estimate(w1.id, [
    { type: "SERVICO", desc: "Revisão periódica completa", min: 180, price: 126000, svc: "REV-01" },
    { type: "PECA", desc: "Óleo sintético 0W-40", qty: 9, price: 16500, cost: 8900, inv: "OL-0W40-1L" },
    { type: "PECA", desc: "Filtro de óleo — aplicação 911 (992)", price: 39000, cost: 21000, inv: "FO-911-992" },
    ...freios,
  ]);
  await approveAll(v1.id);
  await execute(w1.id, tec);
  await db.$transaction(async (tx) => {
    await transition(tx, w1.id, "CONTROLE_QUALIDADE", tec);
    await tx.qualityControl.create({ data: { workOrderId: w1.id, inspectorId: tec2.id, inspectorName: tec2.name, result: "APROVADO", checklist: { "Serviços executados": true, Vazamentos: true, Níveis: true, "Painel sem alertas": true, "Varredura de códigos": true, Limpeza: true } } });
    await transition(tx, w1.id, "PREPARACAO", tec2, { reason: "CQ aprovado" });
    await transition(tx, w1.id, "PRONTO_ENTREGA", consultor);
  });
  const wo1 = await db.workOrder.findUniqueOrThrow({ where: { id: w1.id }, include: { services: true, parts: true } });
  const total1 = wo1.services.reduce((s, x) => s + x.price, 0) + wo1.parts.filter((p) => p.status === "APLICADA").reduce((s, x) => s + x.price, 0);
  await db.$transaction(async (tx) => {
    await tx.payment.create({ data: { number: await nextNumber(tx, branch.id, "REC"), workOrderId: w1.id, method: "PIX", amount: total1, userId: consultor.id, userName: consultor.name } });
    await tx.checkOut.create({ data: { workOrderId: w1.id, km: vehicles[0].mileage + 128, fuelLevel: 55, receivedBy: "Titular (fictício)", receivedByRelation: "TITULAR", recommendations: "Trocar discos dianteiros em ~8.000 km", removedPartsReturned: true, deliveredById: consultor.id, deliveredByName: consultor.name, signedName: "Titular (fictício)", signatureData: "", contentHash: "seed" } });
    await transition(tx, w1.id, "ENTREGUE", consultor, { reason: "Check-out assinado" });
  });

  // 2) Em execução (freios, disco sem estoque → aguardando peças)
  const w2 = await openWO(2, "Vibração no volante ao frear em alta velocidade.", tec2.id, 1);
  await diagnose(w2.id, tec2, "Discos dianteiros empenados e pastilhas no limite.");
  const v2 = await estimate(w2.id, [
    { type: "SERVICO", desc: "Substituição de discos e pastilhas dianteiros", min: 150, price: 95000, svc: "FRE-02" },
    { type: "PECA", desc: "Disco de freio dianteiro 380 mm", qty: 2, price: 560000, cost: 320000, inv: "DF-DIA-380" },
    { type: "PECA", desc: "Jogo de pastilhas dianteiras cerâmicas", price: 385000, cost: 210000, inv: "PF-DIA-CER" },
    { type: "SERVICO", cls: "PREVENTIVO", desc: "Alinhamento e balanceamento", min: 60, price: 30000, svc: "ALI-01" },
  ]);
  await approveAll(v2.id);

  // 3) Aguardando aprovação do cliente (link)
  const w3 = await openWO(3, "Luz de advertência do motor acesa intermitente.", tec.id, 0);
  await diagnose(w3.id, tec, "Falha intermitente em bobina do cilindro 5; velas com desgaste acima do esperado.");
  await estimate(w3.id, [
    { type: "SERVICO", desc: "Diagnóstico eletrônico", min: 60, price: 45000, svc: "DIAG-01" },
    { type: "TERCEIRO", desc: "Kit de velas e bobina (importação sob encomenda)", price: 780000, cost: 520000 },
    { type: "SERVICO", cls: "RECOMENDADO", desc: "Higienização e carga do ar-condicionado", min: 90, price: 48000, svc: "AC-01" },
  ]);

  // 4) Em execução (Taycan — alta tensão)
  const w4 = await openWO(1, "Revisão anual e mensagem de verificação do sistema de carga.", tec.id, 1);
  await diagnose(w4.id, tec, "Atualização de software do carregador de bordo pendente; bateria HV íntegra (SoH 96%).");
  const v4 = await estimate(w4.id, [
    { type: "SERVICO", desc: "Inspeção de bateria de alta tensão", min: 120, price: 96000, svc: "HV-01" },
    { type: "PECA", desc: "Filtro de cabine carvão ativado", price: 34000, cost: 18000, inv: "FA-CAB-01" },
  ]);
  await approveAll(v4.id);

  // 5) Aguardando diagnóstico e 6) Check-in recém-feito
  await openWO(4, "Barulho na suspensão dianteira em pisos irregulares.", tec2.id, 0);
  await openWO(6, "Revisão de 1 ano / 6.000 km.", null, 0);

  // Agenda de hoje e amanhã
  const today = new Date(); today.setUTCHours(12, 0, 0, 0);
  for (const [vi, h, s] of [[5, 0, "Troca de pneus"], [7, 2, "Revisão periódica"], [0, 26, "Retorno para avaliação de discos"]] as const) {
    await db.appointment.create({
      data: { branchId: branch.id, customerId: vehicles[vi].customerId, vehicleId: vehicles[vi].id, startsAt: new Date(today.getTime() + h * 3600_000), durationMin: 120, services: s, consultantId: consultor.id, createdById: consultor.id, bayId: bays[vi % 4].id },
    });
  }

  console.log("Seed concluído. Usuários de demonstração (senha = SEED_PASSWORD):");
  for (const [, email, role] of people) console.log(`  ${role.padEnd(11)} ${email}`);
  void gestor;
}

main().then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
