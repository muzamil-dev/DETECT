# DETECT

Real-time Eye Movement Tracking & Analytics powered by MediaPipe, Astro (Vite/TS/Bun), and Go.

## Architecture

- **`frontend/`**: Astro (Vite) + TypeScript + Bun + Svelte + MediaPipe FaceMesh
- **`backend/`**: Go REST & WebSocket API with SQLite local database fallback

## Getting Started

### 1. Run Backend (Go)
```bash
cd backend
go run cmd/api/main.go
```
*Runs on http://localhost:8080*

### 2. Run Frontend (Bun + Astro)
```bash
cd frontend
bun run dev
```
*Runs on http://localhost:4321*
