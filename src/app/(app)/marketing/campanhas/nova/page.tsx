import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getSetting, formatBrPhone } from "@/lib/settings";
import { PageHeader } from "@/components/ui";
import { CampaignForm } from "../campaign-form";

export const metadata = { title: "Nova campanha" };
export const dynamic = "force-dynamic";

export default async function NewCampaign({ searchParams }: { searchParams: Promise<{ canal?: string }> }) {
  await requireUser("marketing:campanhas");
  const { canal } = await searchParams;
  const waNumber = formatBrPhone(await getSetting("whatsapp.numero"));
  const initial = canal === "WHATSAPP_MANUAL" || canal === "WHATSAPP_API" || canal === "EMAIL" ? canal : undefined;
  return (
    <>
      <PageHeader title={initial?.startsWith("WHATSAPP") ? "Nova campanha de WhatsApp" : "Nova campanha"} back={<Link href="/marketing/campanhas" className="text-sm text-muted hover:underline">← Campanhas</Link>} />
      <CampaignForm initialChannel={initial} waNumber={waNumber} />
    </>
  );
}
