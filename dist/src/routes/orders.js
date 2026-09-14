import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError, routeParam } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { createGuestToken, createReference, hashToken } from "../lib/security.js";
const router = Router();
const itemInput = z.object({ articleId: z.string().min(1), quantite: z.number().int().positive().max(99) });
const orderInput = z.object({ items: z.array(itemInput).min(1), nom: z.string().min(1).max(80), prenom: z.string().min(1).max(80), email: z.string().email(), telephone: z.string().min(5).max(30), adresse: z.string().min(5).max(300) });
const statusInput = z.object({ status: z.enum(["en-attente", "validee", "expediee", "livree"]) });
const includeOrder = { items: true, messages: { orderBy: { createdAt: "asc" } } };
const dbStatus = (status) => status.replace("-", "_");
const apiOrder = (order) => ({ ...order, status: String(order.status).replace("_", "-") });
async function createOrder(input, clientId) {
    const token = clientId ? null : createGuestToken();
    const guestTokenHash = token ? hashToken(token) : null;
    const order = await prisma.$transaction(async (tx) => {
        const articles = await tx.article.findMany({ where: { id: { in: input.items.map((item) => item.articleId) } } });
        if (articles.length !== input.items.length)
            throw new HttpError(400, "Un article demandé est introuvable.");
        let total = 0;
        const items = [];
        for (const requested of input.items) {
            const article = articles.find((candidate) => candidate.id === requested.articleId);
            const updated = await tx.article.updateMany({ where: { id: article.id, stock: { gte: requested.quantite } }, data: { stock: { decrement: requested.quantite } } });
            if (updated.count !== 1)
                throw new HttpError(409, `Stock insuffisant pour ${article.nom}.`);
            total += article.prix * requested.quantite;
            items.push({ article: { connect: { id: article.id } }, nom: article.nom, prix: article.prix, quantite: requested.quantite });
        }
        const reference = await (async () => { for (;;) {
            const candidate = createReference();
            if (!(await tx.order.findUnique({ where: { reference: candidate }, select: { id: true } })))
                return candidate;
        } })();
        return tx.order.create({ data: { reference, clientId, guestTokenHash, clientNom: `${input.prenom} ${input.nom}`, clientPrenom: input.prenom, clientEmail: input.email, clientTelephone: input.telephone, clientAdresse: input.adresse, total, items: { create: items }, messages: { create: { authorRole: "system", authorNom: "ZEN", text: `Commande ${reference} créée. Un agent va la traiter.` } } }, include: includeOrder });
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
    if (!order)
        throw new HttpError(404, "Commande introuvable ou token invalide.");
    res.json({ order: apiOrder(order) });
}));
router.post("/", authenticate, requireRoles("client"), asyncHandler(async (req, res) => {
    const input = orderInput.parse(req.body);
    const result = await createOrder(input, req.auth.userId);
    res.status(201).json({ order: result.order });
}));
router.get("/", authenticate, asyncHandler(async (req, res) => {
    const where = req.auth.role === "client" ? { clientId: req.auth.userId } : {};
    const orders = await prisma.order.findMany({ where, include: includeOrder, orderBy: { createdAt: "desc" } });
    res.json({ orders: orders.map(apiOrder) });
}));
router.get("/:reference", authenticate, asyncHandler(async (req, res) => {
    const reference = routeParam(req.params.reference, "reference");
    const order = await prisma.order.findUnique({ where: { reference }, include: includeOrder });
    if (!order)
        throw new HttpError(404, "Commande introuvable.");
    if (req.auth.role === "client" && order.clientId !== req.auth.userId)
        throw new HttpError(403, "Accès interdit.");
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
    if (!order)
        throw new HttpError(404, "Commande introuvable.");
    await prisma.order.delete({ where: { id: order.id } });
    res.status(204).send();
}));
router.get("/:reference/messages", authenticate, asyncHandler(async (req, res) => {
    const reference = routeParam(req.params.reference, "reference");
    const order = await prisma.order.findUnique({ where: { reference } });
    if (!order)
        throw new HttpError(404, "Commande introuvable.");
    if (req.auth.role === "client" && order.clientId !== req.auth.userId)
        throw new HttpError(403, "Accès interdit.");
    res.json({ messages: await prisma.orderMessage.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } }) });
}));
router.post("/:reference/messages", authenticate, asyncHandler(async (req, res) => {
    const reference = routeParam(req.params.reference, "reference");
    const input = z.object({ text: z.string().trim().min(1).max(2000) }).parse(req.body);
    const order = await prisma.order.findUnique({ where: { reference } });
    if (!order)
        throw new HttpError(404, "Commande introuvable.");
    if (req.auth.role === "client" && order.clientId !== req.auth.userId)
        throw new HttpError(403, "Accès interdit.");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth.userId }, select: { username: true } });
    const message = await prisma.orderMessage.create({ data: { orderId: order.id, authorId: user ? req.auth.userId : undefined, authorRole: req.auth.role, authorNom: user.username, text: input.text } });
    res.status(201).json({ message });
}));
export default router;
