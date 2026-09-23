import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { SupplierForm } from "../supplier-form";

export const metadata = { title: "Novo fornecedor" };

export default async function NewSupplier() {
  await requireUser("fornecedores:editar");
  return (
    <>
      <PageHeader title="Novo fornecedor" back={<Link href="/fornecedores" className="link text-xs">← Fornecedores</Link>} />
      <div className="card card-pad"><SupplierForm /></div>
    </>
  );
}
