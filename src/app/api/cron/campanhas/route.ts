import { NextResponse } from "next/server";
import { runDueCampaigns } from "@/lib/campaigns";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Disparado pelo Vercel Cron a cada minuto (vercel.json). A Vercel envia "Authorization: Bearer $CRON_SECRET". */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const result = await runDueCampaigns();
  return NextResponse.json({ ok: true, result });
}
