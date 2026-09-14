import "dotenv/config";
const required = ["DATABASE_URL", "JWT_SECRET"];
for (const key of required) {
    if (!process.env[key])
        throw new Error(`Variable d'environnement manquante: ${key}`);
}
export const config = {
    port: Number(process.env.PORT ?? 4000),
    frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
    jwtSecret: new TextEncoder().encode(process.env.JWT_SECRET),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "1d",
    cookieName: process.env.COOKIE_NAME ?? "zen_token",
    isProduction: process.env.NODE_ENV === "production",
};
