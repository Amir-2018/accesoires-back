import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function routeParam(value: string | string[] | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new HttpError(400, `Paramètre ${name} invalide.`);
  return value;
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error(error);
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({ error: "Les données envoyées sont invalides.", details: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) });
    return;
  }
  res.status(500).json({ error: "Erreur interne du serveur." });
}
