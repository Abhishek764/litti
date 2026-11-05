# Litti — production image
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
COPY demo ./demo
COPY tsconfig.json ./

# Persistent state: receipt chain, deploy records, Switch agent credentials.
RUN mkdir -p /data && chown node:node /data
ENV HOST=0.0.0.0 \
    APPROVAL_SERVER_PORT=3847 \
    LITTI_DB_PATH=/data/litti.db \
    LITTI_DEPLOY_DIR=/data/deployments \
    SWITCH_CREDS_FILE=/data/litti-switch.json
VOLUME ["/data"]
EXPOSE 3847

USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.APPROVAL_SERVER_PORT||3847)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/index.ts"]
