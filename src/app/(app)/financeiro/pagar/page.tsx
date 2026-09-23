import { requireUser } from "@/lib/auth";
import { TitlesList, type TitleFilters } from "../titles-list";

export const metadata = { title: "Contas a pagar" };

export default async function Payables({ searchParams }: { searchParams: Promise<TitleFilters> }) {
  const user = await requireUser("financeiro:ver");
  return <TitlesList kind="PAGAR" user={user} sp={await searchParams} />;
}
