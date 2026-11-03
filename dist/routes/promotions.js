import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { asyncHandler, HttpError, routeParam } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { activePromotionWhere, dateOnly, utcToday } from "../lib/promotions.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
const router = Router();
const slugSchema = z.string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Le slug doit contenir uniquement des minuscules, chiffres et tirets.");
const dateSchema = z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La date doit respecter le format YYYY-MM-DD.")
    .refine((value) => {
    const date = dateOnly(value);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "La date est invalide.");
export const promotionImageSchema = z.string().trim().min(1).max(8_500_000).refine((value) => {
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(value)) {
        const encoded = value.slice(value.indexOf(",") + 1);
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0)
            return false;
        const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
        const contentLength = encoded.length - padding;
        if (padding === 2 && contentLength % 4 !== 2)
            return false;
        if (padding === 1 && contentLength % 4 !== 3)
            return false;
        return encoded.length * 3 / 4 - padding <= 6 * 1024 * 1024;
    }
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) && value.length <= 2048;
    }
    catch {
        return false;
    }
}, "Fournissez une URL HTTP(S) ou une image PNG, JPG, WebP ou GIF de 6 Mo maximum.");
const promotionFields = {
    slug: slugSchema,
    discountPercent: z.number().int().min(0).max(100),
    badge: z.string().trim().min(1).max(80),
    kicker: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(2000),
    image: promotionImageSchema,
    imageAlt: z.string().trim().min(1).max(255),
    detailTitle: z.string().trim().min(1).max(160),
    detailDescription: z.string().trim().min(1).max(5000),
    highlights: z.array(z.string().trim().min(1).max(500)).max(30),
    startDate: dateSchema,
    endDate: dateSchema,
    isActive: z.boolean(),
};
export const promotionInput = z.object(promotionFields).strict().refine((value) => value.startDate <= value.endDate, { path: ["endDate"], message: "La date de fin doit être égale ou postérieure à la date de début." });
export const promotionPatchInput = z.object(promotionFields).partial().strict();
function isPrismaError(error, code) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
router.get("/", asyncHandler(async (_req, res) => {
    const promotions = await prisma.promotion.findMany({
        where: activePromotionWhere(utcToday()),
        orderBy: [{ startDate: "asc" }, { slug: "asc" }],
    });
    res.json({ promotions });
}));
router.get("/admin", authenticate, requireRoles("supervisor"), asyncHandler(async (_req, res) => {
    const promotions = await prisma.promotion.findMany({ orderBy: [{ startDate: "desc" }, { slug: "asc" }] });
    res.json({ promotions });
}));
router.get("/:slug", asyncHandler(async (req, res) => {
    const slug = slugSchema.parse(routeParam(req.params.slug, "slug"));
    const promotion = await prisma.promotion.findFirst({
        where: { slug, ...activePromotionWhere(utcToday()) },
    });
    if (!promotion)
        throw new HttpError(404, "Promotion introuvable.");
    res.json({ promotion });
}));
router.post("/", authenticate, requireRoles("supervisor"), asyncHandler(async (req, res) => {
    const input = promotionInput.parse(req.body);
    try {
        const promotion = await prisma.promotion.create({
            data: { ...input, startDate: dateOnly(input.startDate), endDate: dateOnly(input.endDate) },
        });
        res.status(201).json({ promotion });
    }
    catch (error) {
        if (isPrismaError(error, "P2002"))
            throw new HttpError(409, "Ce slug de promotion est déjà utilisé.");
        throw error;
    }
}));
router.patch("/:id", authenticate, requireRoles("supervisor"), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, "id");
    const input = promotionPatchInput.parse(req.body);
    if (Object.keys(input).length === 0)
        throw new HttpError(400, "Aucune donnée à modifier.");
    const existing = await prisma.promotion.findUnique({ where: { id } });
    if (!existing)
        throw new HttpError(404, "Promotion introuvable.");
    const nextStartDate = input.startDate ?? existing.startDate.toISOString().slice(0, 10);
    const nextEndDate = input.endDate ?? existing.endDate.toISOString().slice(0, 10);
    if (nextStartDate > nextEndDate) {
        throw new HttpError(400, "La date de fin doit être égale ou postérieure à la date de début.");
    }
    const data = {
        ...input,
        ...(input.startDate ? { startDate: dateOnly(input.startDate) } : {}),
        ...(input.endDate ? { endDate: dateOnly(input.endDate) } : {}),
    };
    try {
        const promotion = await prisma.promotion.update({ where: { id }, data });
        res.json({ promotion });
    }
    catch (error) {
        if (isPrismaError(error, "P2002"))
            throw new HttpError(409, "Ce slug de promotion est déjà utilisé.");
        if (isPrismaError(error, "P2025"))
            throw new HttpError(404, "Promotion introuvable.");
        throw error;
    }
}));
router.delete("/:id", authenticate, requireRoles("supervisor"), asyncHandler(async (req, res) => {
    const id = routeParam(req.params.id, "id");
    try {
        await prisma.promotion.delete({ where: { id } });
        res.status(204).send();
    }
    catch (error) {
        if (isPrismaError(error, "P2025"))
            throw new HttpError(404, "Promotion introuvable.");
        if (isPrismaError(error, "P2003"))
            throw new HttpError(409, "Cette promotion est encore utilisée par un article.");
        throw error;
    }
}));
export default router;
