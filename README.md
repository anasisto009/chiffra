# Chiffra

Agent comptable marocain multi-agents pour un hackathon 55h.

## Stack

- Frontend: React 18, TypeScript, Vite
- Backend: Node.js 20, TypeScript, Fastify
- Agents: LangGraph (`@langchain/langgraph`)
- DB: PostgreSQL 16, montants en `numeric`
- Cache/files/jobs: Redis 7, BullMQ
- Calculs: `decimal.js`
- LLM: endpoint compatible OpenAI via `.env`
- Deploy local: Docker Compose

## Regle absolue

Le LLM orchestre et explique. Il ne calcule jamais.
Tous les totaux, TVA et ecarts sont calcules par du code TypeScript avec `decimal.js`.

## Demarrage

```bash
docker compose up
```

Copie `.env.example` vers `.env` uniquement pour brancher un vrai endpoint LLM.

## Structure

```text
apps/
  api/      Fastify API + agents
  web/      React/Vite frontend
packages/
  shared/   Types, constantes et helpers decimal.js
```
