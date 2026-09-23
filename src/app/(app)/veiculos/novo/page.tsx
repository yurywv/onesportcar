import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { VehicleForm } from "../vehicle-form";
import { createVehicle } from "../actions";

export const metadata = { title: "Novo veículo" };

export default async function NewVehicle({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  await requireUser("veiculos:editar");
  const { cliente } = await searchParams;
  const customers = await db.customer.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="Novo veículo" back={<Link href={cliente ? `/clientes/${cliente}` : "/veiculos"} className="link text-xs">← Voltar</Link>} />
      <div className="card card-pad"><VehicleForm action={createVehicle} customers={customers} customerId={cliente} /></div>
    </>
  );
}
