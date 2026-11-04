# ZEN Backend

API Express + Prisma + PostgreSQL de l’application ZEN.

## Configuration

```bash
cp backend/.env.example backend/.env
```

Configurer au minimum `DATABASE_URL` et `JWT_SECRET`. `DATABASE_URL` doit être une URL PostgreSQL (`postgresql://` ou `postgres://`). Utiliser la connexion interne pour un déploiement Render et la connexion externe depuis un poste local. En local, définir `DATABASE_URL` dans un seul fichier : `prisma/.env` (recommandé) ou `.env`. En production, la fournir comme variable d’environnement. Ne jamais committer les fichiers `.env`.

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
- Tableau de bord superviseur : `GET /api/dashboard/overview?period=30d` (périodes `7d`, `30d`, `90d`)

Le tableau de bord utilise les dates calendaires UTC, comme les règles de validité des promotions. La période inclut aujourd’hui et les jours précédents demandés; les requêtes couvrent `[début à 00:00 UTC, lendemain de la fin à 00:00 UTC)`. Les agrégats sont lus dans une transaction cohérente et les montants utilisent les valeurs historiques enregistrées sur les commandes et leurs lignes.

Les routes de gestion exigent un cookie JWT. Les clients ne peuvent lire que leurs propres conversations et commandes. Les agents voient les conversations assignées ou non assignées. Les Supervisors voient les escalades et les indicateurs de pilotage.

Pour ouvrir une session psql avec la même URL que l’API : `psql "$DATABASE_URL"` (PowerShell : `psql $env:DATABASE_URL`).

Les anciennes migrations MySQL sont conservées sous `prisma/legacy-mysql-migrations`; seules les migrations PostgreSQL de `prisma/migrations` sont actives.

## Démonstration

Le seed crée les comptes et les données de base décrits dans [../examples/demo-data.json](../examples/demo-data.json). Les workflows métier sont décrits dans [../examples/workflows.json](../examples/workflows.json).

## Limites

Le provider IA est optionnel. Avec `AI_PROVIDER=fallback`, les réponses utilisent la recherche locale dans les FAQ. Une base PostgreSQL joignable est nécessaire pour les conversations, commandes, FAQ et indicateurs.

Les commandes du panneau superviseur frontend utilisent actuellement `localStorage` (`zen:orders`), distinct des commandes persistées en PostgreSQL par l’API. Les indicateurs de ce tableau de bord reflètent donc les commandes backend et ne seront pas cohérents avec les commandes locales tant que ce panneau n’est pas raccordé aux routes `/api/orders`.
