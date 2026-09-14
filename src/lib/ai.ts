import { prisma } from "./prisma.js";

export type AiSource = { id: string; title: string; category: string; excerpt: string };
export type AiResult = { text: string; confidence: number; model: string };

function words(value: string): string[] {
  return value.toLowerCase().split(/[^a-zàâçéèêëîïôûùüÿñæœ0-9]+/).filter((word) => word.length > 2);
}

export async function findSources(question: string): Promise<AiSource[]> {
  const candidates = await prisma.knowledgeArticle.findMany({ where: { status: "publie" }, orderBy: { updatedAt: "desc" }, take: 100 });
  const queryWords = words(question);
  return candidates
    .map((article) => ({ article, score: words(`${article.title} ${article.category} ${article.content}`).filter((word) => queryWords.includes(word)).length }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ article }) => ({ id: article.id, title: article.title, category: article.category, excerpt: article.content.slice(0, 280) }));
}

function fallback(question: string, sources: AiSource[]): AiResult {
  if (sources.length === 0) {
    return { text: "Je n'ai pas trouvé de réponse suffisamment fiable dans la base de connaissances. Je transmets votre demande à un agent.", confidence: 32, model: "fallback-rag" };
  }
  return { text: `Selon ${sources[0].title}, ${sources[0].excerpt} Si besoin, un agent peut compléter cette réponse.`, confidence: Math.min(92, 58 + sources.length * 7), model: "fallback-rag" };
}

async function callProvider(question: string, context: string): Promise<AiResult | null> {
  const provider = process.env.AI_PROVIDER ?? "fallback";
  if (provider === "fallback") return null;
  const system = "Tu es l'assistant support de ZEN. Réponds en français, uniquement avec les informations du contexte. Si le contexte est insuffisant, dis-le clairement. Retourne uniquement la réponse destinée au client.";
  if (provider === "n8n") {
    const response = await fetch(process.env.N8N_WEBHOOK_URL!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, context }) });
    if (!response.ok) throw new Error(`n8n a répondu ${response.status}`);
    const data = await response.json() as { text?: string; answer?: string; confidence?: number };
    return { text: data.text ?? data.answer ?? "Réponse indisponible.", confidence: data.confidence ?? 70, model: "n8n" };
  }
  const isGroq = provider === "groq";
  const apiKey = isGroq ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error(`Clé API manquante pour ${provider}.`);
  const endpoint = isGroq ? "https://api.groq.com/openai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const model = process.env.AI_MODEL ?? (isGroq ? "llama-3.1-8b-instant" : "gpt-4o-mini");
  const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: "system", content: system }, { role: "user", content: `Contexte sourcé:\n${context}\n\nQuestion:\n${question}` }] }) });
  if (!response.ok) throw new Error(`Le provider IA a répondu ${response.status}`);
  const data = await response.json() as { choices?: [{ message?: { content?: string } }] };
  return { text: data.choices?.[0]?.message?.content ?? "Réponse indisponible.", confidence: 78, model };
}

export async function generateAiReply(question: string): Promise<{ result: AiResult; sources: AiSource[] }> {
  const sources = await findSources(question);
  const context = sources.map((source) => `[${source.title}] ${source.excerpt}`).join("\n");
  const result = await callProvider(question, context) ?? fallback(question, sources);
  return { result, sources };
}
