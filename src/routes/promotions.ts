import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { asyncHandler, HttpError, routeParam } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { activePromotionWhere, dateOnly, utcToday } from "../lib/promotions.js";
import { promotionSlugFromTitle } from "../lib/promotion-slug.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

const router = Router();

const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La date doit respecter le format YYYY-MM-DD.")
  .refine((value) => {
    const date = dateOnly(value);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "La date est invalide.");

const promotionFields = {
  title: z.string().trim().min(1).max(120),
  discountPercent: z.number().int().min(0).max(100),
  startDate: dateSchema,
  endDate: dateSchema,
};

export const promotionInput = z.object(promotionFields).strict().refine(
  (value) => value.startDate <= value.endDate,
  { path: ["endDate"], message: "La date de fin doit être égale ou postérieure à la date de début." },
);
export const promotionPatchInput = z.object(promotionFields).partial().strict();
export const promotionAdminPatchInput = promotionPatchInput.extend({ isActive: z.boolean().optional() }).strict();

function isPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function promotionSlug(base: string, suffix: number): string {
  return suffix === 1 ? base : `${base}-${suffix}`;
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
  const slug = routeParam(req.params.slug, "slug");
  const promotion = await prisma.promotion.findFirst({
    where: { slug, ...activePromotionWhere(utcToday()) },
  });
  if (!promotion) throw new HttpError(404, "Promotion introuvable.");
  res.json({ promotion });
}));

router.post("/", authenticate, requireRoles("supervisor"), asyncHandler(async (req, res) => {
  const input = promotionInput.parse(req.body);
  const baseSlug = promotionSlugFromTitle(input.title);

  for (let suffix = 1; suffix <= 1000; suffix += 1) {
    try {
      const promotion = await prisma.promotion.create({
        data: {
          ...input,
          slug: promotionSlug(baseSlug, suffix),
          startDate: dateOnly(input.startDate),
          endDate: dateOnly(input.endDate),
        },
      });
      res.status(201).json({ promotion });
      return;
    } catch (error) {
      if (isPrismaError(error, "P2002")) continue;
      throw error;
    }
  }

  throw new HttpError(409, "Impossible de générer un slug unique pour cette promotion.");
}));

router.patch("/:id", authenticate, requireRoles("supervisor"), asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, "id");
  const input = promotionAdminPatchInput.parse(req.body);
  if (Object.keys(input).length === 0) throw new HttpError(400, "Aucune donnée à modifier.");
  const existing = await prisma.promotion.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Promotion introuvable.");

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
  const titleChanged = input.title !== undefined && input.title !== existing.title;
  const baseSlug = titleChanged ? promotionSlugFromTitle(input.title!) : null;

  for (let suffix = 1; suffix <= (baseSlug ? 1000 : 1); suffix += 1) {
    const slug = baseSlug ? promotionSlug(baseSlug, suffix) : existing.slug;
    if (baseSlug && await prisma.promotion.findFirst({ where: { slug, id: { not: id } }, select: { id: true } })) continue;

    try {
      const promotion = await prisma.promotion.update({ where: { id }, data: { ...data, ...(baseSlug ? { slug } : {}) } });
      res.json({ promotion });
      return;
    } catch (error) {
      if (isPrismaError(error, "P2002") && baseSlug) continue;
      if (isPrismaError(error, "P2025")) throw new HttpError(404, "Promotion introuvable.");
      throw error;
    }
  }

  throw new HttpError(409, "Impossible de générer un slug unique pour cette promotion.");
}));

router.delete("/:id", authenticate, requireRoles("supervisor"), asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, "id");
  try {
    await prisma.promotion.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    if (isPrismaError(error, "P2025")) throw new HttpError(404, "Promotion introuvable.");
    if (isPrismaError(error, "P2003")) throw new HttpError(409, "Cette promotion est encore utilisée par un article.");
    throw error;
  }
}));

export default router;
