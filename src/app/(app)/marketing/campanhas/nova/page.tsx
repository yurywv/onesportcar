import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { CampaignForm } from "../campaign-form";

export const metadata = { title: "Nova campanha" };

export default async function NewCampaign() {
  await requireUser("marketing:campanhas");
  return (
    <>
      <PageHeader title="Nova campanha" back={<Link href="/marketing/campanhas" className="text-sm text-muted hover:underline">← Campanhas</Link>} />
      <CampaignForm />
    </>
  );
}
