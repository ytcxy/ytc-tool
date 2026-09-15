#!/usr/bin/env bash
# Run on the Linux server from this repository. Requires Docker and flock, not host Node.js.
# Usage: bash deploy-docker.sh [ENV_FILE] [PORT]
# Default ENV_FILE: server/.env; PORT: 3000. ENV_FILE must target ytc-tool-prod.
# Docker env-file syntax: KEY=value (no export, wrapping quotes or trailing comments).
# Host networking + loopback binding lets 1Panel's host-mode OpenResty proxy localhost.
set -euo pipefail
if [[ ${1:-} == --help ]]; then
 echo 'Usage: bash deploy-docker.sh [ENV_FILE=server/.env] [PORT=3000]'
 echo 'Run on Linux with Docker. Builds and replaces ytc-tool-api; no database migrations.'
 exit 0
fi
(($# <= 2)) || { echo 'Too many arguments'; exit 1; }
root=$(cd "$(dirname "$0")" && pwd)
cd "$root"
env_file=${1:-server/.env}
port=${2:-3000}
[[ $port =~ ^[0-9]{1,5}$ ]] && ((10#$port > 0 && 10#$port <= 65535)) || { echo 'Invalid port'; exit 1; }
port=$((10#$port))
[[ $(uname -s) == Linux ]] || { echo 'Run this script on the Linux server, not your Mac.'; exit 1; }
[[ -f $env_file ]] || { echo "Missing configuration: $env_file (see README.md)"; exit 1; }
for cmd in docker flock; do command -v "$cmd" >/dev/null || { echo "Missing $cmd"; exit 1; }; done
docker info >/dev/null
# Serialize builds and replacements without modifying or deleting other applications.
exec 9>"$root/.deploy-docker.lock"
flock -n 9 || { echo 'Another deployment is running'; exit 1; }
name=ytc-tool-api
version=$(date -u +%Y%m%dT%H%M%SZ)-$$
image="ytc-tool-api:$version"
backup="$name-backup-$version"
stage=$(mktemp -d)
old_saved=false
old_running=false
new_created=false
success=false
cleanup() {
 code=$?
 trap - EXIT
 if ! $success; then
  if $new_created; then docker rm -f "$name" >/dev/null || true; fi
  if $old_saved; then
   echo 'Restoring previous container' >&2
   docker rename "$backup" "$name"
   if $old_running; then docker start "$name" >/dev/null; fi
  fi
 fi
 rm -rf "$stage"
 exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Build context allowlist: secrets, uploads, .git and local node_modules never enter the image.
mkdir -p "$stage/server" "$stage/miniprogram"
cp package.json package-lock.json "$stage/"
cp miniprogram/package.json "$stage/miniprogram/"
cp server/package.json server/tsconfig.json server/nest-cli.json "$stage/server/"
cp -R server/src server/scripts server/migrations "$stage/server/"
cat > "$stage/Dockerfile" <<'DOCKERFILE'
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
COPY --from=build /app/server/scripts ./server/scripts
COPY --from=build /app/server/migrations ./server/migrations
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
WORKDIR /app/server
HEALTHCHECK --interval=5s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health/database',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
DOCKERFILE
docker build --pull -t "$image" "$stage"
# Validate secrets without printing their values or connecting to the database.
docker run --rm --network none --env-file "$env_file" -e PORT="$port" "$image" node -e '
require("./dist/config.js").validateConfig(process.env);
if(process.env.DB_NAME!=="ytc-tool-prod")throw Error("Set DB_NAME=ytc-tool-prod in the deployment env file");
for(const k of ["WECHAT_APP_ID","WECHAT_APP_SECRET"]){if(!process.env[k]?.trim())throw Error("Missing "+k)}
'
if docker container inspect "$name" >/dev/null 2>&1; then
 [[ $(docker inspect -f '{{index .Config.Labels "ytc-tool.managed"}}' "$name") == true ]] || { echo 'Refusing to replace an unmanaged container'; exit 1; }
 [[ $(docker inspect -f '{{.State.Running}}' "$name") != true ]] || old_running=true
 docker rename "$name" "$backup"
 old_saved=true
 docker stop "$backup" >/dev/null
fi
# Fail on port conflicts instead of killing an unrelated service.
docker run --rm --network host -e PORT="$port" "$image" node -e '
const s=require("node:net").createServer();s.on("error",()=>process.exit(1));s.listen(Number(process.env.PORT),"127.0.0.1",()=>s.close());
'
mkdir -p /opt/ytc-tool/audio/files
chmod 755 /opt/ytc-tool/audio /opt/ytc-tool/audio/files
docker create --name "$name" --label ytc-tool.managed=true \
 --restart unless-stopped --init --network host --env-file "$env_file" \
 --security-opt no-new-privileges:true --cap-drop ALL \
 --log-opt max-size=10m --log-opt max-file=3 \
 -e NODE_ENV=production -e PORT="$port" -e BIND_HOST=127.0.0.1 \
 -e TRUST_LOOPBACK_PROXY=true -e UPLOAD_DIR=/app/uploads \
 -e AUDIO_SOURCE=database -e AUDIO_DIR=/app/audio \
 --mount type=bind,source=/opt/ytc-tool/audio,target=/app/audio,readonly \
 --mount type=volume,source=ytc-tool-uploads,target=/app/uploads "$image" >/dev/null
new_created=true
docker start "$name" >/dev/null
for attempt in {1..40}; do
 status=$(docker inspect -f '{{.State.Health.Status}}' "$name")
 if [[ $status == healthy ]]; then success=true; break; fi
 [[ $(docker inspect -f '{{.State.Running}}' "$name") == true ]] || break
 sleep 2
done
$success || { echo "Startup failed; recent logs below, then reverting."; docker logs --tail 80 "$name" >&2 || true; exit 1; }
if $old_saved; then docker rm "$backup" >/dev/null; fi
echo "Started: $name; upstream: http://127.0.0.1:$port; uploads volume: ytc-tool-uploads"
echo "Logs: docker logs --tail 100 $name"
