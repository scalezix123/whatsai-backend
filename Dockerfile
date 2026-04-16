FROM node:24-bullseye-slim

WORKDIR /app

# Install Bun and OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y curl unzip openssl && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL=/root/.bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

# Copy package manifests
COPY package.json ./
# If there's a lockfile, copy it too
COPY bun.lock* ./

# Install dependencies
# Prisma only needs a syntactically valid URL at build time for code generation.
RUN DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder?schema=public \
  bun install

# Copy configuration and Prisma schema
COPY prisma.config.ts ./
COPY prisma ./prisma/

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Expose the API port
EXPOSE 3001

CMD ["bun", "run", "start"]