/* Dados FICTÍCIOS de compras, fornecedores e tesouraria. Usa as regras de domínio (pedido → aprovação → recebimento → estoque → títulos).
   Pode rodar sobre um banco já semeado: só age se ainda não houver fornecedores. */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { nextNumber } from "../src/lib/sequence";
import { submitPurchaseOrder, approvePurchaseOrder, markSent, receivePurchaseOrder } from "../src/lib/purchasing";
import { createTitles, settleTitle, transferFunds } from "../src/lib/finance";
import type { SessionUser } from "../src/lib/auth";

const ACC = { CAIXA: "00000000-0000-4000-8000-000000000001", BANCO: "00000000-0000-4000-8000-000000000002", CARTAO: "00000000-0000-4000-8000-000000000003" };
const CAT = { ALUGUEL: "00000000-0000-4000-8000-000000000204", ENERGIA: "00000000-0000-4000-8000-000000000205", FOLHA: "00000000-0000-4000-8000-000000000203", TAXAS: "00000000-0000-4000-8000-000000000206", OUTRAS_REC: "00000000-0000-4000-8000-000000000109" };
const CC = { OFI: "00000000-0000-4000-8000-000000000301", ADM: "00000000-0000-4000-8000-000000000302" };

function cnpj(seed: number) {
  const b = String(10000000 + seed * 7919).slice(0, 8) + "0001";
  const dv = (s: string) => { let w = 2, sum = 0; for (let i = s.length - 1; i >= 0; i--) { sum += Number(s[i]) * w; w = w === 9 ? 2 : w + 1; } const r = sum % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(b); return b + d1 + dv(b + d1);
}

export async function seedSupply(db: PrismaClient, password: string) {
  if (await db.supplier.count()) { console.log("Fornecedores já existem — seed de compras/financeiro ignorado."); return; }
  const as = async (email: string): Promise<SessionUser> => {
    const u = await db.user.findUniqueOrThrow({ where: { email } });
    return { id: u.id, name: u.name, email: u.email, role: u.role, branchId: u.branchId };
  };
  const gestor = await as("gestor@onesportcar.demo");
  const financeiro = await as("financeiro@onesportcar.demo");
  const estoque = await as("estoque@onesportcar.demo");
  let compradorUser = await db.user.findUnique({ where: { email: "compras@onesportcar.demo" } });
  if (!compradorUser) compradorUser = await db.user.create({ data: { branchId: gestor.branchId, name: "Comprador Demo", email: "compras@onesportcar.demo", role: "COMPRADOR", passwordHash: await bcrypt.hash(password, 12) } });
  const comprador = await as("compras@onesportcar.demo");

  const sup = async (i: number, name: string, tradeName: string, specialties: string, brands: string, paymentTerms: string, leadTimeDays: number, rating: number) =>
    db.supplier.create({ data: { document: cnpj(i), name, tradeName, specialties, brands, paymentTerms, leadTimeDays, rating, contactName: "Contato (fictício)", email: `vendas${i}@fornecedor.test`, whatsapp: `(11) 9800${i}-00${i}${i}`, city: "São Paulo", uf: "SP" } });
  const dist = await sup(1, "Distribuidora Exemplo de Peças Premium Ltda. (fictícia)", "Exemplo Premium Parts", "Freios, filtros, suspensão", "Porsche, BMW, Mercedes-AMG, Audi", "30/60", 5, 5);
  const lub = await sup(2, "Lubrificantes Exemplo Comércio Ltda. (fictícia)", "Exemplo Lubes", "Óleos, fluidos, químicos", "Multimarcas", "28", 2, 4);
  const pneus = await sup(3, "Pneus Exemplo Comércio Ltda. (fictícia)", "Exemplo Pneus", "Pneus de alta performance", "Multimarcas", "30/60/90", 3, 4);
  await sup(4, "Importadora Exemplo de Autopeças Ltda. (fictícia)", "Exemplo Import", "Peças importadas sob encomenda", "Ferrari, Lamborghini, McLaren", "0", 20, 3);

  const item = (sku: string) => db.inventoryItem.findUniqueOrThrow({ where: { sku } });
  const prefer: [string, string][] = [["PF-DIA-CER", dist.id], ["DF-DIA-380", dist.id], ["SEN-DESG", dist.id], ["FO-911-992", dist.id], ["FA-CAB-01", dist.id], ["AMO-DIA", dist.id], ["OL-0W40-1L", lub.id], ["FLU-DOT4", lub.id], ["QUI-LIMP-FR", lub.id], ["PN-2453520", pneus.id]];
  for (const [sku, supplierId] of prefer) await db.inventoryItem.update({ where: { sku }, data: { supplierId } });

  // Saldos iniciais das contas (apenas ambiente de demonstração)
  await db.financialAccount.update({ where: { id: ACC.BANCO }, data: { openingBalance: 8_500_000, bank: "Banco Exemplo", agency: "0001", accountNumber: "12345-6" } });
  await db.financialAccount.update({ where: { id: ACC.CAIXA }, data: { openingBalance: 200_000 } });

  const po = async (supplierId: string, user: SessionUser, lines: [string, number, number][], opts: { freight?: number; workOrderNumber?: string } = {}) =>
    db.$transaction(async (tx) => {
      const wo = opts.workOrderNumber ? await tx.workOrder.findUnique({ where: { number: opts.workOrderNumber } }) : null;
      const s = await tx.supplier.findUniqueOrThrow({ where: { id: supplierId } });
      const items = await Promise.all(lines.map(([sku]) => tx.inventoryItem.findUniqueOrThrow({ where: { sku } })));
      return tx.purchaseOrder.create({
        data: {
          number: await nextNumber(tx, user.branchId, "PED"), branchId: user.branchId, supplierId, workOrderId: wo?.id, paymentTerms: s.paymentTerms ?? "30",
          freight: opts.freight ?? 0, expectedAt: new Date(Date.now() + (s.leadTimeDays ?? 5) * 86400_000), createdById: user.id, createdByName: user.name,
          items: { create: lines.map(([, qty, cost], i) => ({ inventoryItemId: items[i].id, description: items[i].name, quantity: qty, unitCost: cost, sortOrder: i })) },
        },
      });
    });

  // 1) Discos para a OS-000002 (aguardando peças): aprovado e enviado — falta receber
  const p1 = await po(dist.id, gestor, [["DF-DIA-380", 2, 318000]], { freight: 4500, workOrderNumber: "OS-000002" });
  await db.$transaction(async (tx) => { await submitPurchaseOrder(tx, gestor, p1.id); await markSent(tx, gestor, p1.id); });

  // 2) Lubrificantes: recebido com NF → estoque + contas a pagar
  const p2 = await po(lub.id, comprador, [["OL-0W40-1L", 24, 8700], ["FLU-DOT4", 10, 8800], ["QUI-LIMP-FR", 24, 2750]], { freight: 3500 });
  await db.$transaction(async (tx) => { await submitPurchaseOrder(tx, comprador, p2.id); await markSent(tx, comprador, p2.id); });
  const lines = (await db.purchaseOrderItem.findMany({ where: { purchaseOrderId: p2.id } })).map((i) => ({ poItemId: i.id, quantity: i.quantity }));
  await db.$transaction((tx) => receivePurchaseOrder(tx, estoque, { purchaseOrderId: p2.id, lines, invoiceNumber: "000.123 (fictícia)", invoiceDate: new Date(Date.now() - 10 * 86400_000) }));

  // 3) Pneus acima da alçada do comprador → aguardando aprovação do gestor
  const p3 = await po(pneus.id, comprador, [["PN-2453520", 4, 289000]]);
  await db.$transaction((tx) => submitPurchaseOrder(tx, comprador, p3.id));

  // 4) Amortecedores: rascunho
  await po(dist.id, comprador, [["AMO-DIA", 2, 640000]]);
  void approvePurchaseOrder; void item;

  // Despesas fixas e contas a pagar
  const day = 86400_000;
  await db.$transaction(async (tx) => {
    await createTitles(tx, financeiro, { kind: "PAGAR", description: "Aluguel do galpão", amount: 1_800_000, dueDates: [new Date(Date.now() + 5 * day)], categoryId: CAT.ALUGUEL, costCenterId: CC.ADM, counterparty: "Imobiliária Exemplo (fictícia)", method: "BOLETO" });
    await createTitles(tx, financeiro, { kind: "PAGAR", description: "Energia elétrica", amount: 412_390, dueDates: [new Date(Date.now() - 2 * day)], categoryId: CAT.ENERGIA, costCenterId: CC.OFI, counterparty: "Distribuidora de energia (fictícia)", method: "BOLETO" });
    await createTitles(tx, financeiro, { kind: "PAGAR", description: "Folha de pagamento", amount: 4_650_000, dueDates: [new Date(Date.now() + 9 * day)], categoryId: CAT.FOLHA, costCenterId: CC.OFI, counterparty: "Folha (fictícia)", method: "TRANSFERENCIA" });
    const [net] = await createTitles(tx, financeiro, { kind: "PAGAR", description: "Internet e telefonia", amount: 38_990, dueDates: [new Date(Date.now() - 3 * day)], categoryId: CAT.ENERGIA, costCenterId: CC.ADM, counterparty: "Operadora (fictícia)", method: "PIX" });
    await settleTitle(tx, financeiro, { titleId: net.id, accountId: ACC.BANCO, amount: 38_990, method: "PIX", date: new Date(Date.now() - 3 * day) });
    // Contas a receber de cliente PJ (contrato fictício de manutenção de frota), 2 parcelas
    const pj = await tx.customer.findFirst({ where: { type: "PJ" } });
    if (pj) await createTitles(tx, financeiro, { kind: "RECEBER", description: "Contrato de manutenção preventiva (fictício)", amount: 2_400_000, dueDays: [15, 45], categoryId: CAT.OUTRAS_REC, costCenterId: CC.OFI, customerId: pj.id, method: "BOLETO" });
    await transferFunds(tx, financeiro, ACC.CAIXA, ACC.BANCO, 150_000, new Date(Date.now() - day), "Depósito do caixa (demo)");
  });
  console.log("Compras e tesouraria de demonstração criadas. Novo usuário: compras@onesportcar.demo (Comprador).");
}

if (require.main === module) {
  const db = new PrismaClient();
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "1") { console.error("Bloqueado em produção sem ALLOW_DEMO_SEED=1."); process.exit(1); }
  const pw = process.env.SEED_PASSWORD;
  if (!pw || pw.length < 10) { console.error("Defina SEED_PASSWORD (senha do novo usuário comprador)."); process.exit(1); }
  seedSupply(db, pw).then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
}
