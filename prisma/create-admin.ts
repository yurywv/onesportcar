/* Inicializa um ambiente de PRODUÇÃO vazio: empresa, unidade, boxes padrão e o primeiro administrador.
   O administrador define a própria senha por um link de uso único (48 h) — a senha não passa por quem roda o script.
   Uso: ADMIN_EMAIL=... ADMIN_NAME=... APP_URL=https://... npx tsx prisma/create-admin.ts */
import { PrismaClient } from "@prisma/client";
import { createPasswordToken, unusableHash } from "../src/lib/password";
import { isValidEmail } from "../src/lib/validators";

const db = new PrismaClient();

async function main() {
  const { ADMIN_EMAIL, ADMIN_NAME = "Administrador", APP_URL, COMPANY_NAME = "DBL Automotiva Ltda.", COMPANY_DOC = "", BRANCH_NAME = "OneSportcar — Matriz" } = process.env;
  if (!ADMIN_EMAIL || !isValidEmail(ADMIN_EMAIL)) throw new Error("Defina ADMIN_EMAIL com um e-mail válido.");
  if (!APP_URL) throw new Error("Defina APP_URL (endereço público do sistema) para montar o link de primeiro acesso.");
  if (await db.user.count()) { console.log("Já existem usuários — nada foi feito."); return; }
  const token = await db.$transaction(async (tx) => {
    const company = await tx.company.create({ data: { name: COMPANY_NAME, document: COMPANY_DOC } });
    const branch = await tx.branch.create({ data: { companyId: company.id, code: "MTZ", name: BRANCH_NAME } });
    for (let i = 1; i <= 5; i++) await tx.workshopBay.create({ data: { branchId: branch.id, code: `B0${i}`, description: `Box ${i}` } });
    const admin = await tx.user.create({ data: { branchId: branch.id, name: ADMIN_NAME, email: ADMIN_EMAIL.toLowerCase(), role: "ADMIN", passwordHash: await unusableHash() } });
    await tx.auditLog.create({ data: { action: "BOOTSTRAP", entity: "Company", entityId: company.id, userName: "create-admin", after: { adminEmail: ADMIN_EMAIL } } });
    return createPasswordToken(tx, admin.id, "PRIMEIRO_ACESSO");
  });
  console.log(`Ambiente inicializado. Administrador: ${ADMIN_EMAIL}`);
  console.log(`Link de primeiro acesso (uso único, 48 h): ${APP_URL.replace(/\/$/, "")}/definir-senha/${token}`);
}

main().then(() => db.$disconnect()).catch(async (e) => { console.error(e.message); await db.$disconnect(); process.exit(1); });
