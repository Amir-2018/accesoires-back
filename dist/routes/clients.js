import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { asyncHandler, HttpError, routeParam } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
const router = Router();
const publicClient = { id: true, username: true, email: true, createdAt: true, updatedAt: true };
const clientInput = z.object({
    username: z.string().min(2).max(80),
    email: z.string().email().max(160),
    password: z.string().min(8).max(100),
});
router.use(authenticate, requireRoles("supervisor"));
router.get("/", asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(24, Math.max(1, Number(req.query.pageSize) || 8));
    const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const where = { role: "client", ...(search ? { OR: [{ username: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }] } : {}) };
    const [clients, total] = await Promise.all([
        prisma.user.findMany({ where, select: publicClient, orderBy: { username: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
        prisma.user.count({ where }),
    ]);
    res.json({ clients, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
}));
router.post("/", asyncHandler(async (req, res) => {
    const input = clientInput.parse(req.body);
    const exists = await prisma.user.findFirst({ where: { OR: [{ email: input.email }, { username: input.username }] } });
    if (exists)
        throw new HttpError(409, "Cet email ou ce nom utilisateur est déjà utilisé.");
    const client = await prisma.user.create({ data: { username: input.username, email: input.email, passwordHash: await bcrypt.hash(input.password, 12), role: "client" }, select: publicClient });
    res.status(201).json({ client });
}));
router.patch("/:id", asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, "id");
    const input = clientInput.partial().parse(req.body);
    const current = await prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!current || current.role !== "client")
        throw new HttpError(404, "Client introuvable.");
    const data = { ...(input.username ? { username: input.username } : {}), ...(input.email ? { email: input.email } : {}), ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 12) } : {}) };
    const client = await prisma.user.update({ where: { id }, data, select: publicClient });
    res.json({ client });
}));
router.delete("/:id", asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, "id");
    const current = await prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!current || current.role !== "client")
        throw new HttpError(404, "Client introuvable.");
    try {
        await prisma.user.delete({ where: { id } });
    }
    catch {
        throw new HttpError(409, "Ce client possède des commandes ou des conversations et ne peut pas être supprimé.");
    }
    res.status(204).send();
}));
export default router;
