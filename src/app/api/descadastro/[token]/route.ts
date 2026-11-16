import { NextResponse } from "next/server";
import { unsubscribeByToken } from "@/lib/unsubscribe";

export const dynamic = "force-dynamic";

// Descadastro "um clique" (RFC 8058): Gmail/Outlook fazem POST neste endereço pelo botão "Cancelar inscrição".
export async function POST(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await unsubscribeByToken(token, "one-click");
  return new NextResponse("ok", { status: 200 });
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return NextResponse.redirect(new URL(`/descadastro/${encodeURIComponent(token)}`, req.url));
}
