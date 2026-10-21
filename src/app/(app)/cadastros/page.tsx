import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can, type Permission } from "@/lib/rbac";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Cadastros" };

type Card = { href: string; title: string; desc: string; perm: Permission; count?: number };

export default async function Registries() {
  const user = await requireUser();
  const [clientes, veiculos, mecanicos, vendedores, admins, produtos, servicos, fornecedores, contas] = await Promise.all([
    db.customer.count({ where: { active: true } }),
    db.vehicle.count({ where: { active: true } }),
    db.user.count({ where: { role: "TECNICO", active: true } }),
    db.user.count({ where: { active: true, OR: [{ isSeller: true }, { role: "CONSULTOR" }] } }),
    db.user.count({ where: { active: true, role: { in: ["ADMIN", "GESTOR"] } } }),
    db.inventoryItem.count({ where: { active: true } }),
    db.serviceCatalog.count({ where: { active: true } }),
    db.supplier.count({ where: { active: true } }),
    db.financialAccount.count({ where: { active: true } }),
  ]);
  const groups: { title: string; cards: Card[] }[] = [
    { title: "Atendimento", cards: [
      { href: "/clientes", title: "Clientes", desc: "Pessoas físicas e jurídicas, contatos, LGPD", perm: "clientes:ver", count: clientes },
      { href: "/veiculos", title: "Veículos", desc: "Placa, chassi, km e histórico de proprietários", perm: "veiculos:ver", count: veiculos },
    ] },
    { title: "Equipe", cards: [
      { href: "/cadastros/equipe/mecanicos", title: "Mecânicos", desc: "Especialidades, marcas, valor/hora e comissão", perm: "equipe:editar", count: mecanicos },
      { href: "/cadastros/equipe/vendedores", title: "Vendedores", desc: "Comissão sobre serviços e produtos", perm: "equipe:editar", count: vendedores },
      { href: "/cadastros/equipe/administradores", title: "Administradores", desc: "Gestores e administradores do sistema", perm: "equipe:editar", count: admins },
    ] },
    { title: "Produtos e serviços", cards: [
      { href: "/estoque", title: "Produtos", desc: "Peças, óleos, pneus — preço, estoque, NCM/CFOP", perm: "estoque:ver", count: produtos },
      { href: "/catalogo", title: "Serviços", desc: "Tabela de tempos, valor/hora, código de tributação", perm: "orcamento:editar", count: servicos },
      { href: "/fornecedores", title: "Fornecedores", desc: "CNPJ, prazos, condições de pagamento", perm: "compras:ver", count: fornecedores },
    ] },
    { title: "Financeiro e fiscal", cards: [
      { href: "/financeiro/contas", title: "Contas e caixas", desc: "Bancos, caixa e adquirentes (maquininhas)", perm: "financeiro:ver", count: contas },
      { href: "/financeiro/cadastros", title: "Categorias e centros de custo", desc: "Plano de contas gerencial", perm: "financeiro:ver" },
      { href: "/fiscal/configuracao", title: "Emitente fiscal", desc: "CNPJ, IE, IM, regime, séries e numeração de NF-e/NFS-e", perm: "fiscal:configurar" },
    ] },
  ];
  return (
    <>
      <PageHeader title="Cadastros" subtitle="Todos os cadastros do sistema, organizados como no SYSCAR." />
      <div className="space-y-6">
        {groups.map((g) => {
          const cards = g.cards.filter((c) => can(user.role, c.perm));
          if (!cards.length) return null;
          return (
            <section key={g.title}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-muted">{g.title}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {cards.map((c) => (
                  <Link key={c.href} href={c.href} className="card card-pad block transition-colors hover:border-accent">
                    <div className="flex items-baseline justify-between gap-2"><span className="font-semibold">{c.title}</span>{c.count != null && <span className="text-sm tabular-nums text-muted">{c.count.toLocaleString("pt-BR")}</span>}</div>
                    <p className="mt-1 text-sm text-muted">{c.desc}</p>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
