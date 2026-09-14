import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

const articles = [
  { id: "a-robe", nom: "Robe fluide", image: "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=900&q=85", description: "Robe légère à la coupe élégante, parfaite au quotidien.", prix: 499, stock: 16, categorie: "Robes" },
  { id: "a-veste", nom: "Veste en denim", image: "https://images.unsplash.com/photo-1544022613-e87ca75a784a?auto=format&fit=crop&w=900&q=85", description: "Veste en denim intemporelle, facile à porter en toute saison.", prix: 699, stock: 11, categorie: "Vestes" },
  { id: "a-chemise", nom: "Chemise en lin", image: "https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=900&q=85", description: "Chemise en lin respirante avec une coupe décontractée.", prix: 349, stock: 24, categorie: "Chemises" },
  { id: "a-pantalon", nom: "Pantalon droit", image: "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=900&q=85", description: "Pantalon droit confortable, conçu pour accompagner toutes vos tenues.", prix: 449, stock: 19, categorie: "Pantalons" },
  { id: "a-pull", nom: "Pull en maille", image: "https://images.unsplash.com/photo-1614975058789-41316d0e2e9c?auto=format&fit=crop&w=900&q=85", description: "Pull doux en maille avec une silhouette chaleureuse et moderne.", prix: 399, stock: 14, categorie: "Pulls" },
  { id: "a-sneakers", nom: "Sneakers en toile", image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=85", description: "Sneakers en toile souples et légères pour tous les jours.", prix: 549, stock: 21, categorie: "Chaussures" },
];

async function main() {
  const passwordHash = await bcrypt.hash("password123", 12);
  const supervisorPasswordHash = await bcrypt.hash("oumaima2026", 12);
  for (const role of Object.values(UserRole)) {
    const isSupervisor = role === "supervisor";
    const username = isSupervisor ? "oumaima" : role === "client" ? "client.demo" : `${role}.demo`;
    const email = isSupervisor ? "oumaima@gmail.com" : `${role}@zen.local`;
    await prisma.user.upsert({ where: { email }, update: { username, passwordHash: isSupervisor ? supervisorPasswordHash : passwordHash, role }, create: { username, email, passwordHash: isSupervisor ? supervisorPasswordHash : passwordHash, role } });
  }
  for (const nom of [...new Set(articles.map((article) => article.categorie))]) {
    await prisma.category.upsert({ where: { nom }, update: {}, create: { nom } });
  }
  for (const article of articles) await prisma.article.upsert({ where: { id: article.id }, update: article, create: article });
  const knowledge = [
    { id: "kb-livraison", title: "Suivi de livraison", category: "Livraison", content: "Une commande peut être suivie avec sa référence CMD et son statut. Les statuts sont En attente, Validée, Expédiée et Livrée.", status: "publie" },
    { id: "kb-retour", title: "Retours et échanges", category: "Retours", content: "Pour demander un retour ou un échange, le client doit contacter le support avec sa référence de commande et préciser le motif de sa demande.", status: "publie" },
    { id: "kb-paiement", title: "Paiement de la commande", category: "Paiement", content: "Le total de la commande est calculé à partir des prix enregistrés dans le catalogue au moment de la validation.", status: "publie" },
  ];
  for (const entry of knowledge) await prisma.knowledgeArticle.upsert({ where: { id: entry.id }, update: entry, create: entry });
  console.log("Seed ZEN terminé. Superviseur: oumaima@gmail.com / oumaima2026");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
