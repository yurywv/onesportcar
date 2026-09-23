import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const WO_INCLUDE = {
  customer: true,
  vehicle: true,
  bay: true,
  appointment: true,
  checkIn: { include: { damages: true } },
  statusHistory: { orderBy: { createdAt: "asc" } },
  diagnostics: { orderBy: { startedAt: "asc" } },
  inspections: { include: { items: { orderBy: { sortOrder: "asc" } } }, orderBy: { createdAt: "asc" } },
  estimates: {
    include: {
      items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      versions: { include: { approvals: { orderBy: { createdAt: "asc" } }, links: { orderBy: { createdAt: "desc" } } }, orderBy: { version: "desc" } },
    },
    orderBy: { createdAt: "asc" },
  },
  services: { include: { timeEntries: { orderBy: { startedAt: "asc" } } }, orderBy: { createdAt: "asc" } },
  parts: { include: { inventoryItem: true }, orderBy: { createdAt: "asc" } },
  timeEntries: true,
  qualityChecks: { orderBy: { createdAt: "asc" } },
  checkOut: true,
  payments: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.WorkOrderInclude;

export type WO = Prisma.WorkOrderGetPayload<{ include: typeof WO_INCLUDE }>;

export const loadWorkOrder = (id: string) => db.workOrder.findUnique({ where: { id }, include: WO_INCLUDE });
