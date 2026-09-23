import type { SessionUser } from "@/lib/auth";
import type { woTotals } from "@/lib/wo";
import type { WO } from "./data";

export type TabProps = { wo: WO; user: SessionUser; names: Map<string, string>; totals: ReturnType<typeof woTotals>; showMoney: boolean };
