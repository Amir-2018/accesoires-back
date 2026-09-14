import { Router, type Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { config } from "../config.js";
import { asyncHandler, HttpError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { authenticate, createAccessToken } from "../middleware/auth.js";

const router = Router();
const credentials = z.object({
  identifier: z.string().min(2).max(160),
  password: z.string().min(8).max(100),
});
const publicUser = { id: true, username: true, email: true, role: true, createdAt: true } as const;

function setSessionCookie(res: Response, token: string) {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000,
    path: "/",
  });
}

router.post("/register", asyncHandler(async (req, res) => {
  const input = credentials.extend({ username: z.string().min(2).max(80), email: z.string().email().max(160) }).parse(req.body);
  const exists = await prisma.user.findFirst({ where: { OR: [{ email: input.email }, { username: input.username }] } });
  if (exists) throw new HttpError(409, "Cet email ou ce nom utilisateur est déjà utilisé.");
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({ data: { username: input.username, email: input.email, passwordHash }, select: publicUser });
  const token = await createAccessToken(user.id, user.role);
  setSessionCookie(res, token);
  res.status(201).json({ user });
}));

router.post("/login", asyncHandler(async (req, res) => {
  const input = credentials.parse(req.body);
  const user = await prisma.user.findFirst({ where: { OR: [{ email: input.identifier }, { username: input.identifier }] } });
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new HttpError(401, "Email ou mot de passe incorrect.");
  }
  const token = await createAccessToken(user.id, user.role);
  setSessionCookie(res, token);
  const { passwordHash: _passwordHash, ...safeUser } = user;
  res.json({ user: safeUser });
}));

router.get("/me", authenticate, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: publicUser });
  if (!user) throw new HttpError(401, "Utilisateur introuvable.");
  res.json({ user });
}));

router.post("/logout", (_req, res) => {
  res.clearCookie(config.cookieName, { httpOnly: true, secure: config.isProduction, sameSite: "lax", path: "/" });
  res.status(204).send();
});

export default router;
