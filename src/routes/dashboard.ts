import { Router } from "express";
import { Prisma, type OrderStatus } from "@prisma/client";
import { asyncHandler } from "../lib/http.js";
import {
  buildDailySales,
  dashboardDateRange,
  dashboardOrderStatuses,
  dashboardPeriodSchema,
  roundCurrency,
} from "../lib/dashboard.js";
import { prisma } from "../lib/prisma.js";
import { utcToday } from "../lib/promotions.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

const router = Router();

router.get("/overview", authenticate, requireRoles("supervisor"), asyncHandler(async (req, res) => {
  const period = dashboardPeriodSchema.parse(req.query.period);
  const range = dashboardDateRange(period);
  const today = utcToday();

  const overview = await prisma.$transaction(async (tx) => {
    const [aggregates] = await tx.$queryRaw<Array<{
      orderCount: bigint;
      orderAmount: number;
      clientCount: bigint;
      newClientCount: bigint;
      articleCount: bigint;
      lowStockCount: bigint;
      outOfStockCount: bigint;
      activePromotionCount: bigint;
    }>>`
      SELECT
        (SELECT COUNT(*) FROM "Order" WHERE "createdAt" >= ${range.startAt} AND "createdAt" < ${range.endExclusive}) AS "orderCount",
        (SELECT COALESCE(SUM(COALESCE("totalExact", "total")), 0) FROM "Order" WHERE "createdAt" >= ${range.startAt} AND "createdAt" < ${range.endExclusive}) AS "orderAmount",
        (SELECT COUNT(*) FROM "User" WHERE "role" = 'client') AS "clientCount",
        (SELECT COUNT(*) FROM "User" WHERE "role" = 'client' AND "createdAt" >= ${range.startAt} AND "createdAt" < ${range.endExclusive}) AS "newClientCount",
        (SELECT COUNT(*) FROM "Article") AS "articleCount",
        (SELECT COUNT(*) FROM "Article" WHERE "stock" > 0 AND "stock" <= 5) AS "lowStockCount",
        (SELECT COUNT(*) FROM "Article" WHERE "stock" = 0) AS "outOfStockCount",
        (SELECT COUNT(*) FROM "Promotion" WHERE "isActive" = TRUE AND "startDate" <= ${today} AND "endDate" >= ${today}) AS "activePromotionCount"
    `;
    const statuses = await tx.order.groupBy({
      by: ["status"],
      where: { createdAt: { gte: range.startAt, lt: range.endExclusive } },
      _count: { _all: true },
    });
    const dailyRows = await tx.$queryRaw<Array<{ date: string; orderCount: bigint; amount: number }>>`
      SELECT TO_CHAR("createdAt", 'YYYY-MM-DD') AS "date", COUNT(*) AS "orderCount",
        COALESCE(SUM(COALESCE("totalExact", "total")), 0) AS amount
      FROM "Order"
      WHERE "createdAt" >= ${range.startAt} AND "createdAt" < ${range.endExclusive}
      GROUP BY TO_CHAR("createdAt", 'YYYY-MM-DD')
    `;
    const topArticles = await tx.$queryRaw<Array<{ id: string; nom: string; quantity: bigint; amount: number }>>`
      SELECT item."articleId" AS "id", MIN(item."nom") AS "nom", SUM(item."quantite") AS "quantity",
        SUM(COALESCE(item."prixRemise", item."prix") * item."quantite") AS "amount"
      FROM "OrderItem" AS item
      INNER JOIN "Order" AS "order" ON "order"."id" = item."orderId"
      WHERE "order"."createdAt" >= ${range.startAt} AND "order"."createdAt" < ${range.endExclusive}
      GROUP BY item."articleId"
      ORDER BY "quantity" DESC, "amount" DESC, "nom" ASC, "id" ASC
      LIMIT 5
    `;
    const recentOrders = await tx.order.findMany({
      where: { createdAt: { gte: range.startAt, lt: range.endExclusive } },
      select: { id: true, clientNom: true, total: true, totalExact: true, status: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5,
    });

    const orderCount = Number(aggregates.orderCount);
    const orderAmount = roundCurrency(Number(aggregates.orderAmount));
    const countByStatus = new Map(statuses.map((entry) => [entry.status, entry._count._all]));

    return {
      period: { startDate: range.startDate, endDate: range.endDate },
      metrics: {
        orderCount,
        orderAmount,
        averageOrderAmount: orderCount === 0 ? 0 : roundCurrency(orderAmount / orderCount),
        clientCount: Number(aggregates.clientCount),
        newClientCount: Number(aggregates.newClientCount),
        articleCount: Number(aggregates.articleCount),
        lowStockCount: Number(aggregates.lowStockCount),
        outOfStockCount: Number(aggregates.outOfStockCount),
        activePromotionCount: Number(aggregates.activePromotionCount),
      },
      ordersByStatus: dashboardOrderStatuses.map(({ database, api }) => ({
        status: api,
        count: countByStatus.get(database as OrderStatus) ?? 0,
      })),
      dailySales: buildDailySales(range.startDate, range.endDate, dailyRows),
      topArticles: topArticles.map((article) => ({
        id: article.id,
        nom: article.nom,
        quantity: Number(article.quantity),
        amount: roundCurrency(Number(article.amount)),
      })),
      recentOrders: recentOrders.map((order) => ({
        id: order.id,
        clientNom: order.clientNom,
        total: roundCurrency(order.totalExact ?? order.total),
        status: String(order.status).replace("_", "-"),
        createdAt: order.createdAt.toISOString(),
      })),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 });

  res.json(overview);
}));

export default router;
