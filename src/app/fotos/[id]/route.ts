import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { getCustomer } from "@/lib/customer-auth";
import { can } from "@/lib/rbac";

// Foto do veículo: equipe com acesso às OS, ou o próprio cliente (somente fotos liberadas para ele).
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const photo = await db.workOrderPhoto.findUnique({ where: { id }, include: { workOrder: { select: { customerId: true, technicianId: true } } } });
  if (!photo) return new Response("Não encontrada", { status: 404 });
  const user = await getUser();
  let ok = !!user && can(user.role, "os:ver") && (can(user.role, "os:ver_todas") || photo.workOrder.technicianId === user.id);
  if (!ok) {
    const c = await getCustomer();
    ok = !!c && c.id === photo.workOrder.customerId && photo.visibleToCustomer;
  }
  if (!ok) return new Response("Sem permissão", { status: 403 });
  return new Response(new Uint8Array(photo.data), { headers: { "Content-Type": photo.mime, "Cache-Control": "private, max-age=86400" } });
}
