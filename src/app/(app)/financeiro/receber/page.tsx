import { requireUser } from "@/lib/auth";
import { TitlesList, type TitleFilters } from "../titles-list";

export const metadata = { title: "Contas a receber" };

export default async function Receivables({ searchParams }: { searchParams: Promise<TitleFilters> }) {
  const user = await requireUser("financeiro:ver");
  return <TitlesList kind="RECEBER" user={user} sp={await searchParams} />;
}
