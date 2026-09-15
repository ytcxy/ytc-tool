#!/usr/bin/env bash
# Internal remote entry point. All arguments are passed by deploy-remote.sh.
set -euo pipefail
[[ $# == 5 && $EUID == 0 ]] || { echo 'Expected root and five deployment arguments'; exit 1; }
stage=$1 version=$2 port=$3 image_id=$4 platform=$5
[[ $stage =~ ^/tmp/ytc-tool-upload\.[a-zA-Z0-9]+$ && $version =~ ^[0-9]{8}T[0-9]{6}Z-[0-9]+$ && $port =~ ^[0-9]{1,5}$ && $image_id =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1
[[ $platform == linux/amd64 || $platform == linux/arm64 ]] || exit 1
((10#$port > 0 && 10#$port <= 65535)) || exit 1
umask 077
exec 9>/run/lock/ytc-tool-docker.lock
flock -n 9 || { echo 'Another remote deployment is running'; exit 1; }
cd "$stage"
sha256sum -c SHA256SUMS
image="ytc-tool-api:$version"
name=ytc-tool-api
backup="$name-backup-$version"
base=/opt/ytc-tool
release="$base/releases/$version"
old_saved=false old_running=false new_created=false committed=false
[[ ! -e $base/current || -L $base/current ]] || { echo 'current is not a symlink'; exit 1; }
cleanup() {
 code=$?
 trap - EXIT
 if ! $committed; then
  if $new_created; then docker rm -f "$name" >/dev/null || true; fi
  if $old_saved; then
   echo 'Restoring previous container and its original environment' >&2
   docker rename "$backup" "$name" || true
   if $old_running; then docker start "$name" >/dev/null || true; fi
  fi
 fi
 # Uploaded secrets are already stored per release (0600); remove the transport copy.
 rm -f "$stage/server.env" "$stage/image.tar.gz"
 exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
gzip -dc image.tar.gz | docker load
bash "$stage/verify-image.sh" "$image" "$image_id"
[[ $(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image") == "$platform" ]] || { echo 'Image platform mismatch'; exit 1; }
install -d -m 700 "$base" "$base/releases"
install -d -m 755 "$base/audio" "$base/audio/files"
mkdir -m 700 "$release"
install -m 600 server.env "$release/server.env"
printf '%s\n' "$image" > "$release/image.txt"
docker run --rm --pull=never --network none --env-file "$release/server.env" -e PORT="$port" "$image" node -e '
require("./dist/config.js").validateConfig(process.env);
if(process.env.DB_NAME!=="ytc-tool-prod")throw Error("Expected production database");
for(const k of ["WECHAT_APP_ID","WECHAT_APP_SECRET"])if(!process.env[k]?.trim())throw Error("Missing "+k);
'
if docker container inspect "$name" >/dev/null 2>&1; then
 [[ $(docker inspect -f '{{index .Config.Labels "ytc-tool.managed"}}' "$name") == true ]] || { echo 'Refusing to replace an unmanaged container'; exit 1; }
 [[ $(docker inspect -f '{{.State.Running}}' "$name") != true ]] || old_running=true
 docker rename "$name" "$backup"
 old_saved=true
 docker stop "$backup" >/dev/null
fi
docker run --rm --pull=never --network host -e PORT="$port" "$image" node -e '
const s=require("node:net").createServer();s.on("error",()=>process.exit(1));s.listen(Number(process.env.PORT),"127.0.0.1",()=>s.close());
'
docker create --pull=never --name "$name" --label ytc-tool.managed=true \
 --restart unless-stopped --init --network host --env-file "$release/server.env" \
 --security-opt no-new-privileges:true --cap-drop ALL \
 --log-opt max-size=10m --log-opt max-file=3 \
 -e NODE_ENV=production -e PORT="$port" -e BIND_HOST=127.0.0.1 \
 -e TRUST_LOOPBACK_PROXY=true -e UPLOAD_DIR=/app/uploads -e AUDIO_SOURCE=database -e AUDIO_DIR=/app/audio \
 --mount type=bind,source="$base/audio",target=/app/audio,readonly \
 --mount type=volume,source=ytc-tool-uploads,target=/app/uploads "$image" >/dev/null
new_created=true
docker start "$name" >/dev/null
healthy=false
for attempt in {1..40}; do
 if [[ $(docker inspect -f '{{.State.Health.Status}}' "$name") == healthy ]]; then healthy=true; break; fi
 [[ $(docker inspect -f '{{.State.Running}}' "$name") == true ]] || break
 sleep 2
done
$healthy || { echo "Health check failed. Failed image: $image; restoring previous container."; exit 1; }
# Read-only catalog check also detects missing/incompatible learning tables.
docker exec "$name" node -e 'fetch("http://127.0.0.1:"+process.env.PORT+"/api/collections?limit=1",{signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
ln -s "$release" "$base/current-$version"
mv -Tf "$base/current-$version" "$base/current"
committed=true
# Retain the stopped previous container and original env for diagnosis/manual rollback.
echo "Active version: $version; config: $release/server.env; loopback port: $port"
if $old_saved; then echo "Previous container retained: $backup"; fi
