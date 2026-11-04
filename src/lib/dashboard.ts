import { z } from "zod";

export const dashboardPeriodSchema = z.enum(["7d", "30d", "90d"]).default("30d");
export type DashboardPeriod = z.infer<typeof dashboardPeriodSchema>;

const periodDays: Record<DashboardPeriod, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export function dashboardDateRange(period: DashboardPeriod, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - periodDays[period] + 1);
  const endExclusive = new Date(end);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    startAt: start,
    endExclusive,
  };
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export const dashboardOrderStatuses = [
  { database: "en_attente", api: "en-attente" },
  { database: "validee", api: "validee" },
  { database: "expediee", api: "expediee" },
  { database: "livree", api: "livree" },
] as const;

export const lowStockWhere = { stock: { gt: 0, lte: 5 } } as const;
export const outOfStockWhere = { stock: 0 } as const;

export function buildDailySales(
  startDate: string,
  endDate: string,
  rows: Array<{ date: string; orderCount: number | bigint; amount: number | null }>,
) {
  const salesByDate = new Map(rows.map((row) => [row.date, row]));
  const dailySales = [];
  const date = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  while (date <= end) {
    const key = date.toISOString().slice(0, 10);
    const row = salesByDate.get(key);
    dailySales.push({
      date: key,
      orderCount: row ? Number(row.orderCount) : 0,
      amount: roundCurrency(Number(row?.amount ?? 0)),
    });
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return dailySales;
}
