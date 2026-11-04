# ZEN Backend

API Express + Prisma + MySQL de l’application ZEN.

## Configuration

```bash
cp backend/.env.example backend/.env
```

Configurer au minimum `DATABASE_URL` et `JWT_SECRET`. La valeur `DATABASE_URL` doit commencer par `mysql://`; par exemple `mysql://user:password@127.0.0.1:3306/ouou`. Ne jamais committer `backend/.env`.

Les promotions comportent un titre, une remise et une période inclusive évaluée en UTC. Le backend génère leur slug depuis le titre. L’image est celle de l’article associé, pas de la promotion. Après une modification du schéma, appliquer les migrations SQL dans `prisma/migrations` ou `npm run prisma:push`, puis régénérer Prisma Client.

Depuis la racine du dépôt :

```bash
pnpm --dir backend prisma:generate
pnpm --dir backend prisma:push
pnpm --dir backend prisma:seed
pnpm --dir backend dev
```

L’API écoute par défaut sur `http://localhost:4000`.

## Routes principales

- Authentification : `/api/auth/*`
- Catalogue : `/api/articles/*`
- Promotions publiques : `GET /api/promotions` et `GET /api/promotions/:slug`; gestion superviseur : `GET /api/promotions/admin`, `POST /api/promotions`, `PATCH /api/promotions/:id` et `DELETE /api/promotions/:id`.
- Commandes et messages : `/api/orders/*`
- Conversations, brouillons, validation, envoi et escalade : `/api/conversations/*`
- FAQ CRUD et recherche : `/api/conversations/knowledge/articles`
- Pilotage : `GET /api/conversations/analytics/overview`

Les routes de gestion exigent un cookie JWT. Les clients ne peuvent lire que leurs propres conversations et commandes. Les agents voient les conversations assignées ou non assignées. Les Supervisors voient les escalades et les indicateurs de pilotage.

## Démonstration

Le seed crée les comptes et les données de base décrits dans [../examples/demo-data.json](../examples/demo-data.json). Les workflows métier sont décrits dans [../examples/workflows.json](../examples/workflows.json).

## Limites

Le provider IA est optionnel. Avec `AI_PROVIDER=fallback`, les réponses utilisent la recherche locale dans les FAQ. Une base MySQL joignable est nécessaire pour les conversations, commandes, FAQ et indicateurs.
