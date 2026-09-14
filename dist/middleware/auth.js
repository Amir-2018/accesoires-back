import { jwtVerify, SignJWT } from "jose";
import { config } from "../config.js";
import { HttpError } from "../lib/http.js";
export async function createAccessToken(userId, role) {
    return new SignJWT({ role })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime(config.jwtExpiresIn)
        .sign(config.jwtSecret);
}
export async function authenticate(req, _res, next) {
    const token = req.cookies?.[config.cookieName];
    if (!token)
        return next(new HttpError(401, "Authentification requise."));
    try {
        const { payload } = await jwtVerify(token, config.jwtSecret);
        if (!payload.sub || !payload.role)
            throw new Error("Token incomplet");
        req.auth = { userId: payload.sub, role: payload.role };
        next();
    }
    catch {
        next(new HttpError(401, "Session invalide ou expirée."));
    }
}
export function requireRoles(...roles) {
    return (req, _res, next) => {
        if (!req.auth || !roles.includes(req.auth.role)) {
            next(new HttpError(403, "Vous n'avez pas les droits nécessaires."));
            return;
        }
        next();
    };
}
