import { Router } from "express";
import { z } from "zod";
import { ConversationPriority, ConversationStatus, MessageAuthorRole, Prisma } from "@prisma/client";
import { asyncHandler, HttpError, routeParam } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { generateAiReply } from "../lib/ai.js";

const router = Router();
const conversationInclude = {
  messages: { orderBy: { createdAt: "asc" as const }, include: { revisions: true } },
  drafts: { orderBy: { createdAt: "desc" as const } },
  order: { select: { reference: true, status: true, total: true, items: { select: { nom: true, prix: true, quantite: true } } } },
  customer: { select: { id: true, username: true, email: true } },
  assignedAgent: { select: { id: true, username: true } },
};
const messageInput = z.object({ text: z.string().trim().min(1).max(4000) });
const priorityInput = z.enum(["basse", "normale", "haute", "urgente"]);
const statusInput = z.enum(["nouveau", "en-cours", "en-attente", "resolu", "escalade"]);
const toDbStatus = (value: string) => value.replace("-", "_") as ConversationStatus;
const toApi = (conversation: any) => ({ ...conversation, status: String(conversation.status).replace("_", "-"), priority: String(conversation.priority) });
const orderReferencePattern = /\bCMD-?\d+\b/i;

function orderReply(order: { reference: string; status: string; total: number; items: { nom: string; quantite: number }[] }) {
  const statusLabels: Record<string, string> = { "en_attente": "En attente", validee: "Validée", expediee: "Expédiée", livree: "Livrée" };
  const items = order.items.map((item) => `${item.nom} x${item.quantite}`).join(", ");
  return `Votre commande ${order.reference} est actuellement ${statusLabels[order.status] ?? order.status}. Articles : ${items || "aucun article"}. Total : ${order.total.toLocaleString("fr-TN")} DT.`;
}

async function audit(conversationId: string, actorId: string, action: string, entity: string, entityId: string, before?: unknown, after?: unknown) {
  await prisma.auditEvent.create({ data: { conversationId, actorId, action, entity, entityId, before: before as Prisma.InputJsonValue | undefined, after: after as Prisma.InputJsonValue | undefined } });
}

async function getConversation(id: string, userId: string, role: "client" | "agent" | "supervisor") {
  const conversation = await prisma.conversation.findUnique({ where: { id }, include: conversationInclude });
  if (!conversation) throw new HttpError(404, "Conversation introuvable.");
  if (role === "client" && conversation.customerId !== userId) throw new HttpError(403, "Accès interdit.");
  return conversation;
}

router.post("/", authenticate, asyncHandler(async (req, res) => {
  const input = messageInput.extend({ orderId: z.string().optional() }).parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, select: { username: true } });
  const reference = input.text.match(orderReferencePattern)?.[0].toUpperCase().replace(/^CMD(\d)/, "CMD-$1");
  const order = reference ? await prisma.order.findFirst({ where: { reference, clientId: req.auth!.userId }, select: { id: true, reference: true, status: true, total: true, items: { select: { nom: true, quantite: true } } } }) : null;
  const conversation = await prisma.conversation.create({ data: { customerId: req.auth!.userId, orderId: order?.id ?? input.orderId, messages: { create: { authorId: req.auth!.userId, authorRole: "client", authorNom: user.username, text: input.text } } }, include: conversationInclude });
  const { result, sources } = order
    ? { result: { text: orderReply(order), confidence: 96, model: "order-status" }, sources: [] }
    : await generateAiReply(input.text);
  const draft = await prisma.aiDraft.create({ data: { conversationId: conversation.id, generatedText: result.text, confidence: result.confidence, model: result.model, sources: sources as unknown as Prisma.InputJsonValue } });
  await audit(conversation.id, req.auth!.userId, "conversation_created", "conversation", conversation.id, undefined, { question: input.text });
  await audit(conversation.id, req.auth!.userId, "ai_draft_created", "ai_draft", draft.id, undefined, { confidence: result.confidence, model: result.model, sources });
  const refreshed = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id }, include: conversationInclude });
  res.status(201).json({ conversation: toApi(refreshed), draft, sources });
}));

router.get("/", authenticate, asyncHandler(async (req, res) => {
  const status = typeof req.query.status === "string" ? toDbStatus(statusInput.parse(req.query.status)) : undefined;
  const priority = typeof req.query.priority === "string" ? priorityInput.parse(req.query.priority) as ConversationPriority : undefined;
  const where = { ...(status ? { status } : {}), ...(priority ? { priority } : {}), ...(req.auth!.role === "client" ? { customerId: req.auth!.userId } : req.auth!.role === "agent" ? { OR: [{ assignedAgentId: req.auth!.userId }, { assignedAgentId: null }] } : {}) };
  const conversations = await prisma.conversation.findMany({ where, include: conversationInclude, orderBy: [{ priority: "desc" }, { updatedAt: "desc" }] });
  res.json({ conversations: conversations.map(toApi) });
}));

router.get("/analytics/overview", authenticate, requireRoles("agent", "supervisor"), asyncHandler(async (_req, res) => {
  const conversations = await prisma.conversation.findMany({
    select: {
      status: true,
      escalatedAt: true,
      intent: true,
      messages: { select: { authorRole: true, text: true, createdAt: true }, orderBy: { createdAt: "asc" } },
    },
  });
  const responseTimes = conversations.flatMap((conversation) => {
    const firstClient = conversation.messages.find((message) => message.authorRole === "client");
    const firstStaff = conversation.messages.find((message) => message.authorRole === "agent" || message.authorRole === "supervisor");
    if (!firstClient || !firstStaff) return [];
    const minutes = (firstStaff.createdAt.getTime() - firstClient.createdAt.getTime()) / 60000;
    return minutes >= 0 ? [minutes] : [];
  });
  const motifLabels: Record<string, string> = { livraison: "Livraison", retour: "Retours", paiement: "Paiement", commande: "Commande", compte: "Compte", produit: "Produit" };
  function motif(conversation: (typeof conversations)[number]): string {
    if (conversation.intent?.trim()) return conversation.intent.trim();
    const text = conversation.messages.find((message) => message.authorRole === "client")?.text.toLowerCase() ?? "";
    const match = Object.keys(motifLabels).find((keyword) => text.includes(keyword));
    return match ? motifLabels[match] : "Autre";
  }
  const motifCounts = new Map<string, number>();
  conversations.forEach((conversation) => motifCounts.set(motif(conversation), (motifCounts.get(motif(conversation)) ?? 0) + 1));
  const escalated = conversations.filter((conversation) => conversation.escalatedAt || conversation.status === "escalade").length;
  res.json({
    volume: conversations.length,
    firstResponseMinutes: responseTimes.length ? Math.round((responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length) * 10) / 10 : null,
    firstResponseCount: responseTimes.length,
    escalationRate: conversations.length ? Math.round((escalated / conversations.length) * 1000) / 10 : 0,
    escalationCount: escalated,
    motifs: [...motifCounts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 6),
  });
}));

router.get("/:id", authenticate, asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, "id");
  const conversation = await getConversation(id, req.auth!.userId, req.auth!.role);
  res.json({ conversation: toApi(conversation) });
}));

router.post("/:id/messages", authenticate, asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, "id");
  const input = messageInput.parse(req.body);
  const conversation = await getConversation(id, req.auth!.userId, req.auth!.role);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, select: { username: true } });
  const message = await prisma.conversationMessage.create({ data: { conversationId: conversation.id, authorId: req.auth!.userId, authorRole: req.auth!.role as MessageAuthorRole, authorNom: user.username, text: input.text } });
  await prisma.conversation.update({ where: { id }, data: { status: req.auth!.role === "client" ? "en_attente" : "en_cours" } });
  await audit(id, req.auth!.userId, "message_created", "conversation_message", message.id, undefined, { text: input.text, authorRole: req.auth!.role });
  res.status(201).json({ message });
}));

router.post("/:id/ai-draft", authenticate, requireRoles("agent", "supervisor"), asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, "id");
  const conversation = await getConversation(id, req.auth!.userId, req.auth!.role);
  const latest = [...conversation.messages].reverse().find((message) => message.authorRole === "client");
  if (!latest) throw new HttpError(400, "Aucune question client à traiter.");
  const { result, sources } = await generateAiReply(latest.text);
  const draft = await prisma.aiDraft.create({ data: { conversationId: id, generatedText: result.text, confidence: result.confidence, model: result.model, sources: sources as unknown as Prisma.InputJsonValue, createdById: req.auth!.userId } });
  await audit(id, req.auth!.userId, "ai_draft_created", "ai_draft", draft.id, undefined, { confidence: result.confidence, model: result.model, sources });
  res.status(201).json({ draft, sources });
}));

router.patch("/:id/drafts/:draftId", authenticate, requireRoles("agent", "supervisor"), asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, "id");
  const draftId = routeParam(req.params.draftId, "draftId");
  const input = z.object({ editedText: z.string().trim().min(1).max(4000) }).parse(req.body);
  const draft = await prisma.aiDraft.findFirst({ where: { id: draftId, conversationId: id } });
  if (!draft) throw new HttpError(404, "Brouillon IA introuvable.");
  const updated = await prisma.aiDraft.update({ where: { id: draftId }, data: { editedText: input.editedText } });
  await audit(id, req.auth!.userId, "ai_draft_edited", "ai_draft", draftId, { editedText: draft.editedText }, { editedText: input.editedText });
  res.json({ draft: updated });
}));

router.post("/:id/drafts/:draftId/approve", authenticate, requireRoles("agent", "supervisor"), asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, "id");
  const draftId = routeParam(req.params.draftId, "draftId");
  const draft = await prisma.aiDraft.findFirst({ where: { id: draftId, conversationId: id } });
  if (!draft) throw new HttpError(404, "Brouillon IA introuvable.");
  const updated = await prisma.aiDraft.update({ where: { id: draftId }, data: { status: "approuvee", approvedById: req.auth!.userId } });
  await audit(id, req.auth!.userId, "ai_draft_approved", "ai_draft", draftId, { status: draft.status }, { status: updated.status });
  res.json({ draft: updated });
}));

router.post("/:id/drafts/:draftId/send", authenticate, requireRoles("agent", "supervisor"), asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, "id");
  const draftId = routeParam(req.params.draftId, "draftId");
  const draft = await prisma.aiDraft.findFirst({ where: { id: draftId, conversationId: id } });
  if (!draft || draft.status !== "approuvee") throw new HttpError(409, "Le brouillon doit être approuvé avant envoi.");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, select: { username: true } });
  const text = draft.editedText ?? draft.generatedText;
  const result = await prisma.$transaction(async (tx) => {
    const message = await tx.conversationMessage.create({ data: { conversationId: id, authorId: req.auth!.userId, authorRole: req.auth!.role as MessageAuthorRole, authorNom: user.username, text } });
    const sentDraft = await tx.aiDraft.update({ where: { id: draftId }, data: { status: "envoyee" } });
    await tx.conversation.update({ where: { id }, data: { status: "en_attente" } });
    return { message, draft: sentDraft };
  });
  await audit(id, req.auth!.userId, "ai_draft_sent", "ai_draft", draftId, { status: draft.status }, { status: "envoyee", messageId: result.message.id });
  res.status(201).json(result);
}));

router.post("/:id/escalate", authenticate, requireRoles("agent"), asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, "id");
  const reason = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) throw new HttpError(404, "Conversation introuvable.");
  const updated = await prisma.conversation.update({ where: { id }, data: { status: "escalade", priority: "haute", escalatedAt: new Date() } });
  await audit(id, req.auth!.userId, "conversation_escalated", "conversation", id, { status: conversation.status }, { status: updated.status, reason: reason.reason });
  res.json({ conversation: toApi(updated), reason: reason.reason });
}));

router.post("/:id/assign", authenticate, requireRoles("agent", "supervisor"), asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, "id");
  const input = z.object({ agentId: z.string().min(1) }).parse(req.body);
  const agent = await prisma.user.findFirst({ where: { id: input.agentId, role: "agent" } });
  if (!agent) throw new HttpError(404, "Agent introuvable.");
  const updated = await prisma.conversation.update({ where: { id }, data: { assignedAgentId: agent.id, status: "en_cours" } });
  await audit(id, req.auth!.userId, "conversation_assigned", "conversation", id, undefined, { assignedAgentId: agent.id });
  res.json({ conversation: toApi(updated) });
}));

router.get("/:id/audit", authenticate, requireRoles("agent", "supervisor"), asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id, "id");
  res.json({ events: await prisma.auditEvent.findMany({ where: { conversationId: id }, include: { actor: { select: { username: true, role: true } } }, orderBy: { createdAt: "asc" } }) });
}));

const knowledgeInput = z.object({ title: z.string().min(2).max(160), category: z.string().min(2).max(80), content: z.string().min(10).max(10000), status: z.enum(["brouillon", "publie"]).default("brouillon") });
function searchKnowledgeArticles(articles: Awaited<ReturnType<typeof prisma.knowledgeArticle.findMany>>, query: string) {
  const terms = query.toLowerCase().split(/[^a-zàâçéèêëîïôûùüÿñæœ0-9]+/).filter((term) => term.length > 2);
  if (terms.length === 0) return articles;
  return articles
    .map((article) => ({ article, score: terms.reduce((score, term) => score + (article.title.toLowerCase().includes(term) ? 4 : 0) + (article.category.toLowerCase().includes(term) ? 3 : 0) + (article.content.toLowerCase().includes(term) ? 1 : 0), 0) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ article }) => article);
}
router.get("/knowledge/articles", authenticate, requireRoles("agent", "supervisor"), asyncHandler(async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const articles = await prisma.knowledgeArticle.findMany({ orderBy: { updatedAt: "desc" } });
  res.json({ articles: searchKnowledgeArticles(articles, query) });
}));
router.post("/knowledge/articles", authenticate, requireRoles("agent", "supervisor"), asyncHandler(async (req, res) => { res.status(201).json({ article: await prisma.knowledgeArticle.create({ data: knowledgeInput.parse(req.body) }) }); }));
router.patch("/knowledge/articles/:id", authenticate, requireRoles("agent", "supervisor"), asyncHandler(async (req, res) => { const id = routeParam(req.params.id, "id"); const input = knowledgeInput.partial().parse(req.body); res.json({ article: await prisma.knowledgeArticle.update({ where: { id }, data: { ...input, version: { increment: 1 } } }) }); }));
router.delete("/knowledge/articles/:id", authenticate, requireRoles("agent", "supervisor"), asyncHandler(async (req, res) => { const id = routeParam(req.params.id, "id"); await prisma.knowledgeArticle.delete({ where: { id } }); res.status(204).send(); }));

export default router;
