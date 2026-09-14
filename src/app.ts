import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { config } from "./config.js";
import { errorHandler } from "./lib/http.js";
import authRoutes from "./routes/auth.js";
import articleRoutes from "./routes/articles.js";
import clientRoutes from "./routes/clients.js";
import categoryRoutes from "./routes/categories.js";
import orderRoutes from "./routes/orders.js";
import conversationRoutes from "./routes/conversations.js";

export const app = express();
const allowedOrigins = new Set([config.frontendUrl, "http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"]);
app.use(cors({ origin: (origin, callback) => {
	if (!origin || allowedOrigins.has(origin)) callback(null, true);
	else callback(new Error("Origine frontend non autorisée."));
}, credentials: true }));
app.use(express.json({ limit: "8mb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/articles", articleRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/conversations", conversationRoutes);
app.use(errorHandler);
