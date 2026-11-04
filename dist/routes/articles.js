import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { assertPromotionExists } from "../lib/article-promotions.js";
import { asyncHandler, HttpError, routeParam } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { articlePromotionFilter, promotionSelect, utcToday } from "../lib/promotions.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
const router = Router();
export const articleInput = z.object({
    id: z.string().min(1).max(80),
    nom: z.string().min(1).max(120),
    image: z.string().refine((value) => value === "" || (() => {
        try {
            new URL(value);
            return true;
        }
        catch {
            return /^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(value);
        }
    })(), "L’image doit être une URL ou un fichier image valide."),
    description: z.string().max(1000),
    prix: z.number().int().nonnegative(),
    stock: z.number().int().nonnegative(),
    categorie: z.string().min(1).max(80),
    promotionId: z.string().trim().min(1).max(191).nullable().optional(),
});
const articleWithPromotion = { promotion: { select: promotionSelect } };
router.get("/", asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(24, Math.max(1, Number(req.query.pageSize) || 6));
    const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const category = typeof req.query.categorie === "string" ? req.query.categorie.trim() : "";
    const promotionSlug = typeof req.query.promotion === "string" ? req.query.promotion.trim() : "";
    const today = utcToday();
    const where = {
        ...(category ? { categorie: category } : {}),
        ...(search ? { OR: [{ nom: { contains: search } }, { description: { contains: search } }, { categorie: { contains: search } }] } : {}),
        ...(promotionSlug ? articlePromotionFilter(promotionSlug, today) : {}),
    };
    const [articles, total] = await Promise.all([
        prisma.article.findMany({ where, include: articleWithPromotion, orderBy: { nom: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
        prisma.article.count({ where }),
    ]);
    res.json({ articles, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
}));
router.get("/:id", asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, "id");
    const article = await prisma.article.findUnique({ where: { id }, include: articleWithPromotion });
    if (!article)
        throw new HttpError(404, "Article introuvable.");
    res.json({ article });
}));
router.post("/", authenticate, requireRoles("supervisor"), asyncHandler(async (req, res) => {
    const input = articleInput.parse(req.body);
    const article = await prisma.$transaction(async (tx) => {
        if (!(await tx.category.findUnique({ where: { nom: input.categorie }, select: { id: true } }))) {
            throw new HttpError(400, "Cette catégorie n’existe pas.");
        }
        await assertPromotionExists(input.promotionId, async (id) => tx.promotion.findUnique({ where: { id }, select: { id: true } }));
        return tx.article.create({ data: input, include: articleWithPromotion });
    });
    res.status(201).json({ article });
}));
router.patch("/:id", authenticate, requireRoles("supervisor"), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, "id");
    const input = articleInput.omit({ id: true }).partial().parse(req.body);
    const article = await prisma.$transaction(async (tx) => {
        if (input.categorie && !(await tx.category.findUnique({ where: { nom: input.categorie }, select: { id: true } }))) {
            throw new HttpError(400, "Cette catégorie n’existe pas.");
        }
        await assertPromotionExists(input.promotionId, async (promotionId) => tx.promotion.findUnique({ where: { id: promotionId }, select: { id: true } }));
        try {
            return await tx.article.update({ where: { id }, data: input, include: articleWithPromotion });
        }
        catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
                throw new HttpError(404, "Article introuvable.");
            }
            throw error;
        }
    });
    res.json({ article });
}));
router.delete("/:id", authenticate, requireRoles("supervisor"), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, "id");
    try {
        await prisma.article.delete({ where: { id } });
    }
    catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
            throw new HttpError(404, "Article introuvable.");
        }
        throw error;
    }
    res.status(204).send();
}));
export default router;
