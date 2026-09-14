import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError, routeParam } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
const router = Router();
const categoryInput = z.object({ nom: z.string().trim().min(2).max(80) });
router.get("/", asyncHandler(async (_req, res) => {
    res.json({ categories: await prisma.category.findMany({ orderBy: { nom: "asc" } }) });
}));
router.use(authenticate, requireRoles("supervisor"));
router.post("/", asyncHandler(async (req, res) => {
    const category = await prisma.category.create({ data: categoryInput.parse(req.body) });
    res.status(201).json({ category });
}));
router.patch("/:id", asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, "id");
    const previous = await prisma.category.findUnique({ where: { id } });
    if (!previous)
        throw new HttpError(404, "Catégorie introuvable.");
    const category = await prisma.category.update({ where: { id }, data: categoryInput.parse(req.body) });
    await prisma.article.updateMany({ where: { categorie: previous.nom }, data: { categorie: category.nom } });
    res.json({ category });
}));
router.delete("/:id", asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, "id");
    const category = await prisma.category.findUnique({ where: { id } });
    if (!category)
        throw new HttpError(404, "Catégorie introuvable.");
    const used = await prisma.article.count({ where: { categorie: category.nom } });
    if (used > 0)
        throw new HttpError(409, "Cette catégorie est encore utilisée par un article.");
    await prisma.category.delete({ where: { id } });
    res.status(204).send();
}));
export default router;
