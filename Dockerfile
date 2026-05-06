# syntax=docker/dockerfile:1.7
# Multi-stage build per https://elysiajs.com/patterns/deploy:
# compile a single static binary on the Bun image, then ship it from
# a distroless base for a small, shell-less production image.

FROM oven/bun:1 AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production

RUN bun build \
    --compile \
    --minify-whitespace \
    --minify-syntax \
    --outfile server \
    src/index.ts

FROM gcr.io/distroless/base

WORKDIR /app

COPY --from=build /app/server ./server

ENV NODE_ENV=production
ENV PORT=8000

EXPOSE 8000

CMD ["./server"]
