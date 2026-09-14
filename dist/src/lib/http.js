import { ZodError } from "zod";
export class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
export function routeParam(value, name) {
    if (typeof value !== "string" || value.length === 0)
        throw new HttpError(400, `Paramètre ${name} invalide.`);
    return value;
}
export function asyncHandler(handler) {
    return (req, res, next) => {
        handler(req, res, next).catch(next);
    };
}
export function errorHandler(error, _req, res, _next) {
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
