import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { Importer } from "@/components/importer";

export const metadata = { title: "Nova importação" };

export default async function NewImport() {
  await requireUser("admin:importar");
  const [customers, vehicles, suppliers, items, legacyOs] = await Promise.all([
    db.customer.count({ where: { origin: "SYSCAR" } }), db.vehicle.count({ where: { legacyCode: { not: null } } }),
    db.supplier.count({ where: { legacyCode: { not: null } } }), db.inventoryItem.count({ where: { legacyCode: { not: null }, active: true } }),
    db.workOrder.count({ where: { legacy: true } }),
  ]);
  return (
    <>
      <PageHeader title="Nova importação" back={<Link href="/admin/importacao" className="link text-xs">← Importações</Link>} />
      <Importer counts={{ CLIENTES: customers, VEICULOS: vehicles, FORNECEDORES: suppliers, ITENS: items, OS: legacyOs }} />
    </>
  );
}
