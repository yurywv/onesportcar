/* Inicializa um ambiente de PRODUÇÃO vazio: empresa, unidade, boxes padrão e o primeiro administrador.
   Uso: ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_NAME=... npx tsx prisma/create-admin.ts */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = "Administrador", COMPANY_NAME = "DBL Automotiva Ltda.", COMPANY_DOC = "", BRANCH_NAME = "OneSportcar — Matriz" } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error("Defina ADMIN_EMAIL e ADMIN_PASSWORD.");
  if (ADMIN_PASSWORD.length < 12) throw new Error("ADMIN_PASSWORD deve ter ao menos 12 caracteres.");
  if (await db.user.count()) { console.log("Já existem usuários — nada foi feito."); return; }
  const company = await db.company.create({ data: { name: COMPANY_NAME, document: COMPANY_DOC } });
  const branch = await db.branch.create({ data: { companyId: company.id, code: "MTZ", name: BRANCH_NAME } });
  for (let i = 1; i <= 5; i++) await db.workshopBay.create({ data: { branchId: branch.id, code: `B0${i}`, description: `Box ${i}` } });
  await db.user.create({ data: { branchId: branch.id, name: ADMIN_NAME, email: ADMIN_EMAIL.toLowerCase(), role: "ADMIN", passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12) } });
  await db.auditLog.create({ data: { action: "BOOTSTRAP", entity: "Company", entityId: company.id, userName: "create-admin", after: { adminEmail: ADMIN_EMAIL } } });
  console.log(`Ambiente inicializado. Administrador: ${ADMIN_EMAIL}`);
}

main().then(() => db.$disconnect()).catch(async (e) => { console.error(e.message); await db.$disconnect(); process.exit(1); });
