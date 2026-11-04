import { Router } from "express";
import { z } from "zod";
import type { OrderStatus, Prisma } from "@prisma/client";
import { asyncHandler, HttpError, routeParam } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { utcToday } from "../lib/promotions.js";
import { calculateOrderPricing } from "../lib/order-pricing.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { createGuestToken, createReference, hashToken } from "../lib/security.js";

const router = Router();
const itemInput = z.object({ articleId: z.string().min(1), quantite: z.number().int().positive().max(99) });
const orderInput = z.object({
  items: z.array(itemInput).min(1).refine((items) => new Set(items.map((item) => item.articleId)).size === items.length, "Un article ne peut apparaître qu’une fois dans le panier."),
  promotionSlug: z.string().trim().min(2).max(191).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable().optional(),
  nom: z.string().min(1).max(80),
  prenom: z.string().min(1).max(80),
  email: z.string().email(),
  telephone: z.string().min(5).max(30),
  adresse: z.string().min(5).max(300),
}).strict();
const statusInput = z.object({ status: z.enum(["en-attente", "validee", "expediee", "livree"]) });
const includeOrder = { items: true, messages: { orderBy: { createdAt: "asc" as const } } };
const dbStatus = (status: string) => status.replace("-", "_") as OrderStatus;
const apiOrder = (order: any) => {
  const { totalExact, ...safeOrder } = order;
  return {
    ...safeOrder,
    total: totalExact ?? order.total,
    status: String(order.status).replace("_", "-"),
    items: order.items?.map((item: any) => ({
      ...item,
      prix: item.prixRemise ?? item.prix,
      prixOriginal: item.prixOriginal ?? item.prix,
      discountPercent: item.discountPercent ?? 0,
    })),
  };
};

async function createOrder(input: z.infer<typeof orderInput>, clientId?: string) {
  const token = clientId ? null : createGuestToken();
  const guestTokenHash = token ? hashToken(token) : null;
  const order = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const today = utcToday(now);
    const articles = await tx.article.findMany({
      where: { id: { in: input.items.map((item) => item.articleId) } },
      include: { promotion: true },
    });
    if (articles.length !== input.items.length) throw new HttpError(400, "Un article demandé est introuvable.");
    if (input.promotionSlug) {
      const requestedPromotion = await tx.promotion.findFirst({
        where: { slug: input.promotionSlug, isActive: true, startDate: { lte: today }, endDate: { gte: today } },
        select: { id: true },
      });
      if (!requestedPromotion) throw new HttpError(400, "Cette promotion est invalide ou n’est plus disponible.");
      if (!articles.some((article) => article.promotionId === requestedPromotion.id)) {
        throw new HttpError(400, "Aucun article du panier ne bénéficie de cette promotion.");
      }
    }
    const pricing = calculateOrderPricing(input.items, articles, now);
    const items: Prisma.OrderItemCreateWithoutOrderInput[] = [];
    for (const requested of input.items) {
      const article = articles.find((candidate) => candidate.id === requested.articleId)!;
      const updated = await tx.article.updateMany({ where: { id: article.id, stock: { gte: requested.quantite } }, data: { stock: { decrement: requested.quantite } } });
      if (updated.count !== 1) throw new HttpError(409, `Stock insuffisant pour ${article.nom}.`);
    }
    for (const item of pricing.items) {
      const { articleId, prix, prixOriginal, ...snapshot } = item;
      items.push({ article: { connect: { id: articleId } }, prix: prixOriginal, prixOriginal, prixRemise: prix, ...snapshot });
    }
    const reference = await (async () => { for (;;) { const candidate = createReference(); if (!(await tx.order.findUnique({ where: { reference: candidate }, select: { id: true } }))) return candidate; } })();
    return tx.order.create({ data: { reference, clientId, guestTokenHash, clientNom: `${input.prenom} ${input.nom}`, clientPrenom: input.prenom, clientEmail: input.email, clientTelephone: input.telephone, clientAdresse: input.adresse, subtotal: pricing.subtotal, discountTotal: pricing.discountTotal, promotionSlug: input.promotionSlug ?? null, total: Math.round(pricing.subtotal), totalExact: pricing.total, items: { create: items }, messages: { create: { authorRole: "system", authorNom: "ZEN", text: `Commande ${reference} créée. Un agent va la traiter.` } } }, include: includeOrder });
  });
  return { order: apiOrder(order), trackingToken: token };
}

router.post("/guest", asyncHandler(async (req, res) => {
  const input = orderInput.parse(req.body);
  const result = await createOrder(input);
  res.status(201).json({ reference: result.order.reference, trackingToken: result.trackingToken, order: result.order });
}));

router.get("/guest/:reference", asyncHandler(async (req, res) => {
  const reference = routeParam(req.params.reference, "reference");
  const token = z.string().min(20).parse(req.query.token);
  const order = await prisma.order.findFirst({ where: { reference, guestTokenHash: hashToken(token) }, include: includeOrder });
  if (!order) throw new HttpError(404, "Commande introuvable ou token invalide.");
  res.json({ order: apiOrder(order) });
}));

router.post("/", authenticate, requireRoles("client"), asyncHandler(async (req, res) => {
  const input = orderInput.parse(req.body);
  const result = await createOrder(input, req.auth!.userId);
  res.status(201).json({ order: result.order });
}));

router.get("/", authenticate, asyncHandler(async (req, res) => {
  const where = req.auth!.role === "client" ? { clientId: req.auth!.userId } : {};
  const orders = await prisma.order.findMany({ where, include: includeOrder, orderBy: { createdAt: "desc" } });
  res.json({ orders: orders.map(apiOrder) });
}));

router.get("/:reference", authenticate, asyncHandler(async (req, res) => {
  const reference = routeParam(req.params.reference, "reference");
  const order = await prisma.order.findUnique({ where: { reference }, include: includeOrder });
  if (!order) throw new HttpError(404, "Commande introuvable.");
  if (req.auth!.role === "client" && order.clientId !== req.auth!.userId) throw new HttpError(403, "Accès interdit.");
  res.json({ order: apiOrder(order) });
}));

router.patch("/:reference/status", authenticate, requireRoles("agent", "supervisor"), asyncHandler(async (req, res) => {
  const reference = routeParam(req.params.reference, "reference");
  const input = statusInput.parse(req.body);
  const order = await prisma.order.update({ where: { reference }, data: { status: dbStatus(input.status) }, include: includeOrder });
  res.json({ order: apiOrder(order) });
}));

router.delete("/:reference", authenticate, requireRoles("supervisor"), asyncHandler(async (req, res) => {
  const reference = routeParam(req.params.reference, "reference");
  const order = await prisma.order.findUnique({ where: { reference }, select: { id: true } });
  if (!order) throw new HttpError(404, "Commande introuvable.");
  await prisma.order.delete({ where: { id: order.id } });
  res.status(204).send();
}));

router.get("/:reference/messages", authenticate, asyncHandler(async (req, res) => {
  const reference = routeParam(req.params.reference, "reference");
  const order = await prisma.order.findUnique({ where: { reference } });
  if (!order) throw new HttpError(404, "Commande introuvable.");
  if (req.auth!.role === "client" && order.clientId !== req.auth!.userId) throw new HttpError(403, "Accès interdit.");
  res.json({ messages: await prisma.orderMessage.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } }) });
}));

router.post("/:reference/messages", authenticate, asyncHandler(async (req, res) => {
  const reference = routeParam(req.params.reference, "reference");
  const input = z.object({ text: z.string().trim().min(1).max(2000) }).parse(req.body);
  const order = await prisma.order.findUnique({ where: { reference } });
  if (!order) throw new HttpError(404, "Commande introuvable.");
  if (req.auth!.role === "client" && order.clientId !== req.auth!.userId) throw new HttpError(403, "Accès interdit.");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, select: { username: true } });
  const message = await prisma.orderMessage.create({ data: { orderId: order.id, authorId: user ? req.auth!.userId : undefined, authorRole: req.auth!.role, authorNom: user.username, text: input.text } });
  res.status(201).json({ message });
}));

export default router;
