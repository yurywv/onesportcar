import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Imagem usada em e-mail marketing. Pública (o e-mail do cliente precisa carregar); id aleatório não adivinhável. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clean = id.replace(/\.(jpe?g|png|gif|webp)$/i, "");
  if (!/^[0-9a-f-]{36}$/i.test(clean)) return new Response("not found", { status: 404 });
  const a = await db.campaignAsset.findUnique({ where: { id: clean }, select: { data: true, mime: true } });
  if (!a) return new Response("not found", { status: 404 });
  return new Response(Buffer.from(a.data), {
    headers: { "Content-Type": a.mime, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
