# Litti — production image

# Build: compile TypeScript to dist/
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Run: compiled JavaScript + runtime dependencies only
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY public ./public
COPY demo/sample-diffs ./demo/sample-diffs
COPY docs/guide ./docs/guide

# Persistent state: receipt chain and deploy records.
RUN mkdir -p /data && chown node:node /data
ENV HOST=0.0.0.0 \
    APPROVAL_SERVER_PORT=3847 \
    LITTI_DB_PATH=/data/litti.db \
    LITTI_DEPLOY_DIR=/data/deployments
VOLUME ["/data"]
EXPOSE 3847

USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.APPROVAL_SERVER_PORT||3847)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
