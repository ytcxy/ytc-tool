FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY miniprogram/package.json ./miniprogram/package.json
COPY server/package.json ./server/package.json
RUN npm ci --workspace server --ignore-scripts --no-audit --no-fund
COPY server ./server
RUN npm run build --workspace server

FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY miniprogram/package.json ./miniprogram/package.json
COPY server/package.json ./server/package.json
RUN npm ci --omit=dev --workspace server --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/server/dist ./server/dist
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
WORKDIR /app/server
HEALTHCHECK --interval=5s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health/database',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
