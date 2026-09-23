import { redirect } from "next/navigation";
import { getUser, logout } from "@/lib/auth";
import { can, ROLE_LABEL, type Permission } from "@/lib/rbac";
import { Shell, type NavItem } from "@/components/shell";

const NAV: (NavItem & { perm: Permission })[] = [
  { href: "/", label: "Dashboard", icon: "LayoutDashboard", perm: "dashboard:ver" },
  { href: "/agenda", label: "Agenda", icon: "CalendarDays", perm: "agenda:ver" },
  { href: "/clientes", label: "Clientes", icon: "Users", perm: "clientes:ver" },
  { href: "/veiculos", label: "Veículos", icon: "Car", perm: "veiculos:ver" },
  { href: "/oficina/kanban", label: "Kanban", icon: "Columns3", perm: "os:ver", group: "Oficina" },
  { href: "/os", label: "Ordens de Serviço", icon: "ClipboardList", perm: "os:ver", group: "Oficina" },
  { href: "/estoque", label: "Estoque", icon: "Package", perm: "estoque:ver", group: "Suprimentos" },
  { href: "/compras", label: "Pedidos de compra", icon: "ShoppingCart", perm: "compras:ver", group: "Suprimentos" },
  { href: "/fornecedores", label: "Fornecedores", icon: "Truck", perm: "compras:ver", group: "Suprimentos" },
  { href: "/catalogo", label: "Catálogo de serviços", icon: "Wrench", perm: "orcamento:editar", group: "Suprimentos" },
  { href: "/financeiro", label: "Tesouraria", icon: "Landmark", perm: "financeiro:ver", group: "Financeiro" },
  { href: "/financeiro/receber", label: "Contas a receber", icon: "ArrowDownToLine", perm: "financeiro:ver", group: "Financeiro" },
  { href: "/financeiro/pagar", label: "Contas a pagar", icon: "ArrowUpFromLine", perm: "financeiro:ver", group: "Financeiro" },
  { href: "/financeiro/contas", label: "Contas e extratos", icon: "Wallet", perm: "financeiro:ver", group: "Financeiro" },
  { href: "/admin/usuarios", label: "Usuários", icon: "UserCog", perm: "admin:usuarios", group: "Administração" },
  { href: "/admin/auditoria", label: "Auditoria", icon: "ShieldCheck", perm: "auditoria:ver", group: "Administração" },
];

async function doLogout() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const nav = NAV.filter((n) => can(user.role, n.perm)).map(({ perm: _p, ...n }) => n);
  return (
    <Shell nav={nav} user={{ name: user.name, role: ROLE_LABEL[user.role] }} logout={doLogout}>
      {children}
    </Shell>
  );
}
