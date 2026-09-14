import type { NextFunction, Request, Response } from "express";
import { jwtVerify, SignJWT } from "jose";
import type { UserRole } from "@prisma/client";
import { config } from "../config.js";
import { HttpError } from "../lib/http.js";

export async function createAccessToken(userId: string, role: UserRole): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(config.jwtExpiresIn)
    .sign(config.jwtSecret);
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[config.cookieName];
  if (!token) return next(new HttpError(401, "Authentification requise."));
  try {
    const { payload } = await jwtVerify(token, config.jwtSecret);
    if (!payload.sub || !payload.role) throw new Error("Token incomplet");
    req.auth = { userId: payload.sub, role: payload.role as UserRole };
    next();
  } catch {
    next(new HttpError(401, "Session invalide ou expirée."));
  }
}

export function requireRoles(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      next(new HttpError(403, "Vous n'avez pas les droits nécessaires."));
      return;
    }
    next();
  };
}
