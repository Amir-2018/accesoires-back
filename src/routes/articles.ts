import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError, routeParam } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { authenticate, requireRoles } from "../middleware/auth.js";

const router = Router();
async function ensureCategory(name: string) {
  if (!(await prisma.category.findUnique({ where: { nom: name } }))) throw new HttpError(400, "Cette catégorie n’existe pas.");
}
const articleInput = z.object({
  id: z.string().min(1).max(80),
  nom: z.string().min(1).max(120),
  image: z.string().refine((value) => value === "" || (() => {
    try {
      new URL(value);
      return true;
    } catch {
      return /^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(value);
    }
  })(), "L’image doit être une URL ou un fichier image valide."),
  description: z.string().max(1000),
  prix: z.number().int().nonnegative(),
  stock: z.number().int().nonnegative(),
  categorie: z.string().min(1).max(80),
});

router.get("/", asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(24, Math.max(1, Number(req.query.pageSize) || 6));
  const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const category = typeof req.query.categorie === "string" ? req.query.categorie.trim() : "";
  const where = { ...(category ? { categorie: category } : {}), ...(search ? { OR: [{ nom: { contains: search, mode: "insensitive" as const } }, { description: { contains: search, mode: "insensitive" as const } }, { categorie: { contains: search, mode: "insensitive" as const } }] } : {}) };
  const [articles, total] = await Promise.all([
    prisma.article.findMany({ where, orderBy: { nom: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.article.count({ where }),
  ]);
  res.json({ articles, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, "id");
  const article = await prisma.article.findUnique({ where: { id } });
  if (!article) throw new HttpError(404, "Article introuvable.");
  res.json({ article });
}));

router.post("/", authenticate, requireRoles("supervisor"), asyncHandler(async (req, res) => {
  const input = articleInput.parse(req.body);
  await ensureCategory(input.categorie);
  const article = await prisma.article.create({ data: input });
  res.status(201).json({ article });
}));

router.patch("/:id", authenticate, requireRoles("supervisor"), asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, "id");
  const input = articleInput.omit({ id: true }).partial().parse(req.body);
  if (input.categorie) await ensureCategory(input.categorie);
  const article = await prisma.article.update({ where: { id }, data: input });
  res.json({ article });
}));

router.delete("/:id", authenticate, requireRoles("supervisor"), asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, "id");
  await prisma.article.delete({ where: { id } });
  res.status(204).send();
}));

export default router;
