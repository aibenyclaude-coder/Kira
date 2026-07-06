# Kira MCP server — stdio transport.
# Multi-stage per our own corpus scar (docker-no-multistage-build):
# dev deps stay in the build stage; the runtime image carries dist + corpus only.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY skills ./skills
COPY routes ./routes
# MCP over stdio — the client talks to this process directly.
CMD ["node", "dist/index.js"]
