import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { km } from "@/lib/format";
import { PageHeader, Empty, Plate, Pager } from "@/components/ui";

export const metadata = { title: "Veículos" };
const PAGE = 30;

export default async function Vehicles({ searchParams }: { searchParams: Promise<{ q?: string; p?: string }> }) {
  const user = await requireUser("veiculos:ver");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number(sp.p) || 1);
  const norm = q.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const where: Prisma.VehicleWhereInput = q ? {
    OR: [
      { plate: { contains: norm } }, { vin: { contains: norm } },
      { make: { contains: q, mode: "insensitive" } }, { model: { contains: q, mode: "insensitive" } },
      { customer: { name: { contains: q, mode: "insensitive" } } },
    ],
  } : {};
  const [rows, total] = await Promise.all([
    db.vehicle.findMany({ where, include: { customer: true }, orderBy: [{ make: "asc" }, { model: "asc" }], skip: (page - 1) * PAGE, take: PAGE }),
    db.vehicle.count({ where }),
  ]);
  return (
    <>
      <PageHeader title="Veículos" subtitle={`${total} veículo(s)`} actions={can(user.role, "veiculos:editar") && <Link href="/veiculos/novo" className="btn btn-primary">Novo veículo</Link>} />
      <form className="mb-4 flex gap-2">
        <input name="q" defaultValue={q} className="input max-w-md" placeholder="Placa, chassi, marca, modelo ou cliente" />
        <button className="btn">Filtrar</button>
      </form>
      {rows.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Placa</th><th>Veículo</th><th>Ano</th><th>Proprietário</th><th className="text-right">Km</th></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td><Plate plate={v.plate} /></td>
                  <td><Link href={`/veiculos/${v.id}`} className="link">{v.make} {v.model}</Link> <span className="text-muted">{v.version}</span></td>
                  <td>{v.yearModel ?? "—"}</td>
                  <td>{v.customer.name}</td>
                  <td className="text-right tabular-nums">{km(v.mileage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>Nenhum veículo encontrado.</Empty>}
      <Pager page={page} total={total} size={PAGE} params={{ q }} />
    </>
  );
}
