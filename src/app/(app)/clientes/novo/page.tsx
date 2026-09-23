import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { CustomerForm } from "../customer-form";
import { createCustomer } from "../actions";

export const metadata = { title: "Novo cliente" };

export default async function NewCustomer() {
  await requireUser("clientes:editar");
  return (
    <>
      <PageHeader title="Novo cliente" back={<Link href="/clientes" className="link text-xs">← Clientes</Link>} />
      <div className="card card-pad"><CustomerForm action={createCustomer} /></div>
    </>
  );
}
