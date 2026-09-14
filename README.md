# ZEN Backend

API Express + Prisma + PostgreSQL de l’application ZEN.

## Configuration

```bash
cp backend/.env.example backend/.env
```

Configurer au minimum `DATABASE_URL` et `JWT_SECRET`. Ne jamais committer `backend/.env`.

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
- Commandes et messages : `/api/orders/*`
- Conversations, brouillons, validation, envoi et escalade : `/api/conversations/*`
- FAQ CRUD et recherche : `/api/conversations/knowledge/articles`
- Pilotage : `GET /api/conversations/analytics/overview`

Les routes de gestion exigent un cookie JWT. Les clients ne peuvent lire que leurs propres conversations et commandes. Les agents voient les conversations assignées ou non assignées. Les Supervisors voient les escalades et les indicateurs de pilotage.

## Démonstration

Le seed crée les comptes et les données de base décrits dans [../examples/demo-data.json](../examples/demo-data.json). Les workflows métier sont décrits dans [../examples/workflows.json](../examples/workflows.json).

## Limites

Le provider IA est optionnel. Avec `AI_PROVIDER=fallback`, les réponses utilisent la recherche locale dans les FAQ. Une base PostgreSQL joignable est nécessaire pour les conversations, commandes, FAQ et indicateurs.
