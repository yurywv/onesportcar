import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { getCustomer } from "@/lib/customer-auth";
import { can } from "@/lib/rbac";
import { phaseOf } from "@/lib/phases";

// Imagem atual de uma câmera do tipo SNAPSHOT, buscada pelo servidor (a URL com credenciais não chega ao navegador).
// Cliente: só a câmera associada à fase atual da OS dele. Equipe: qualquer câmera ativa.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cam = await db.camera.findUnique({ where: { id } });
  if (!cam || !cam.active || cam.kind !== "SNAPSHOT") return new Response("Não encontrada", { status: 404 });
  const user = await getUser();
  let ok = !!user && can(user.role, "cameras:ver");
  if (!ok) {
    const c = await getCustomer();
    const woId = new URL(req.url).searchParams.get("os");
    const wo = c && woId ? await db.workOrder.findUnique({ where: { id: woId } }) : null;
    const phase = wo ? phaseOf(wo.status) : null;
    if (wo && phase && wo.customerId === c!.id && cam.customerVisible) {
      const assigned = await db.workOrderCamera.findMany({ where: { workOrderId: wo.id, phase } });
      ok = assigned.length ? assigned.some((a) => a.cameraId === cam.id) : !!(await db.cameraPhaseDefault.findFirst({ where: { cameraId: cam.id, phase } }));
    }
  }
  if (!ok) return new Response("Sem permissão", { status: 403 });
  try {
    const u = new URL(cam.url);
    const headers: Record<string, string> = {};
    if (u.username) {
      headers.Authorization = `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64")}`;
      u.username = ""; u.password = "";
    }
    const r = await fetch(u, { headers, cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!r.ok) return new Response("Câmera indisponível", { status: 502 });
    return new Response(await r.arrayBuffer(), { headers: { "Content-Type": r.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "no-store" } });
  } catch {
    return new Response("Câmera indisponível", { status: 502 });
  }
}
