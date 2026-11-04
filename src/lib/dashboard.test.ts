import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDailySales,
  dashboardDateRange,
  dashboardOrderStatuses,
  dashboardPeriodSchema,
  lowStockWhere,
  outOfStockWhere,
  roundCurrency,
} from "./dashboard.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { HttpError } from "./http.js";

test("dashboard accepts only supported periods and defaults only an omitted value", () => {
  assert.equal(dashboardPeriodSchema.parse(undefined), "30d");
  for (const period of ["7d", "30d", "90d"]) {
    assert.equal(dashboardPeriodSchema.parse(period), period);
  }
  for (const period of ["1d", "14d", "", ["7d"], null]) {
    assert.equal(dashboardPeriodSchema.safeParse(period).success, false);
  }
});

test("dashboard periods include today and the configured number of UTC calendar days", () => {
  const now = new Date("2026-03-01T22:30:00.000Z");
  const sevenDays = dashboardDateRange("7d", now);
  assert.equal(sevenDays.startDate, "2026-02-23");
  assert.equal(sevenDays.endDate, "2026-03-01");
  assert.equal(sevenDays.startAt.toISOString(), "2026-02-23T00:00:00.000Z");
  assert.equal(sevenDays.endExclusive.toISOString(), "2026-03-02T00:00:00.000Z");
  assert.equal(dashboardDateRange("30d", now).startDate, "2026-01-31");
  assert.equal(dashboardDateRange("90d", now).startDate, "2025-12-02");
});

test("daily sales include empty days in chronological order", () => {
  assert.deepEqual(buildDailySales("2026-11-02", "2026-11-04", [
    { date: "2026-11-02", orderCount: 2n, amount: 10.1234 },
    { date: "2026-11-04", orderCount: 1n, amount: 6 },
  ]), [
    { date: "2026-11-02", orderCount: 2, amount: 10.123 },
    { date: "2026-11-03", orderCount: 0, amount: 0 },
    { date: "2026-11-04", orderCount: 1, amount: 6 },
  ]);
});

test("dashboard status ordering and stock thresholds match the API contract", () => {
  assert.deepEqual(dashboardOrderStatuses.map(({ api }) => api), ["en-attente", "validee", "expediee", "livree"]);
  assert.deepEqual(lowStockWhere, { stock: { gt: 0, lte: 5 } });
  assert.deepEqual(outOfStockWhere, { stock: 0 });
});

test("average monetary values use the backend three-decimal convention", () => {
  assert.equal(roundCurrency(10 / 3), 3.333);
  assert.equal(roundCurrency(1.005), 1.005);
  assert.equal(roundCurrency(0), 0);
});

test("dashboard role guard allows supervisors and denies other roles", () => {
  const middleware = requireRoles("supervisor");
  let supervisorError: unknown;
  middleware({ auth: { userId: "supervisor-1", role: "supervisor" } } as never, {} as never, (error?: unknown) => {
    supervisorError = error;
  });
  assert.equal(supervisorError, undefined);

  let agentError: unknown;
  middleware({ auth: { userId: "agent-1", role: "agent" } } as never, {} as never, (error?: unknown) => {
    agentError = error;
  });
  assert.ok(agentError instanceof HttpError);
  assert.equal((agentError as HttpError).status, 403);
});

test("dashboard authentication guard rejects requests without a session cookie", async () => {
  let receivedError: unknown;
  await authenticate({ cookies: {} } as never, {} as never, (error?: unknown) => {
    receivedError = error;
  });
  assert.ok(receivedError instanceof HttpError);
  assert.equal((receivedError as HttpError).status, 401);
});
