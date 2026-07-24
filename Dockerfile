# Stage 1: Build Frontend with Bun
FROM oven/bun:1.2-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/bun.lock ./
RUN bun install
COPY frontend/ ./
RUN bun run build

# Stage 2: Build Backend with Go
FROM golang:1.25-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main cmd/api/main.go

# Stage 3: Unified Single Container Runner
FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=backend-builder /app/backend/main ./main
COPY --from=frontend-builder /app/frontend/dist ./dist

ENV PORT=8080
ENV STATIC_DIR=/app/dist/client
EXPOSE 8080

CMD ["./main"]
