#!/usr/bin/env bash
set -euo pipefail
usage() { echo 'Usage: bash deploy-remote.sh --host HOST --env-file FILE [--user root] [--ssh-port 22] [--port 3000] [--plan]'; }
host='' env_file='' user=root ssh_port=22 port=3000 plan=false
while (($#)); do
 case "$1" in
  --host|--env-file|--user|--ssh-port|--port)
   (($# >= 2)) || { usage; exit 1; }; key=$1; value=$2; shift 2
   case "$key" in --host) host=$value;; --env-file) env_file=$value;; --user) user=$value;; --ssh-port) ssh_port=$value;; --port) port=$value;; esac;;
  --plan) plan=true; shift;;
  --help) usage; exit 0;;
  *) usage; exit 1;;
 esac
done
[[ $host =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ && $user =~ ^[a-z_][a-z0-9_-]*$ && -n $env_file ]] || { usage; exit 1; }
for number in "$port" "$ssh_port"; do
 [[ $number =~ ^[0-9]{1,5}$ ]] && ((10#$number > 0 && 10#$number <= 65535)) || { echo 'Invalid port'; exit 1; }
done
port=$((10#$port)); ssh_port=$((10#$ssh_port))
root=$(cd "$(dirname "$0")" && pwd)
[[ $env_file == /* ]] || env_file="$PWD/$env_file"
cd "$root"
umask 077
stage=$(mktemp -d /tmp/ytc-remote.XXXXXXXX)
target="$user@$host"
ssh_opts=(-p "$ssh_port" -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ControlMaster=auto -o ControlPersist=60 -o "ControlPath=$stage/ssh.sock")
connected=false
cleanup() {
 code=$?
 if $connected; then ssh "${ssh_opts[@]}" -O exit "$target" >/dev/null 2>&1 || true; fi
 rm -rf "$stage"
 exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node deploy/prepare-env.mjs "$env_file" "$stage/server.env"
echo "Target: $target:$ssh_port; production database; listen 127.0.0.1:$port"
if $plan; then echo 'Plan: detect remote architecture -> test/build -> save/upload image + env -> activate -> health check/rollback. No connection or deployment performed.'; exit 0; fi
for cmd in docker npm ssh scp shasum gzip; do command -v "$cmd" >/dev/null || { echo "Missing $cmd"; exit 1; }; done
docker info >/dev/null
docker buildx version >/dev/null
privilege='sudo -n '
[[ $user != root ]] || privilege=''
echo 'Checking remote Docker and architecture (SSH may ask for your password)...'
connected=true
arch=$(ssh "${ssh_opts[@]}" "$target" "${privilege}bash -s" <<'REMOTE'
set -euo pipefail
[[ $(uname -s) == Linux && $EUID == 0 ]] || { echo 'Linux + root/sudo required' >&2; exit 1; }
for cmd in docker flock sha256sum gzip tar; do command -v "$cmd" >/dev/null || { echo "Missing $cmd" >&2; exit 1; }; done
[[ $(docker info --format '{{.OSType}}') == linux ]] || exit 1
docker info --format '{{.Architecture}}'
REMOTE
)
case "$arch" in x86_64|amd64) platform=linux/amd64;; aarch64|arm64) platform=linux/arm64;; *) echo 'Unsupported or ambiguous server architecture'; exit 1;; esac
echo "Building $platform locally..."
npm run typecheck
npm test
version=$(date -u +%Y%m%dT%H%M%SZ)-$$
image="ytc-tool-api:$version"
context="$stage/context"
mkdir -p "$context/server" "$context/miniprogram"
cp package.json package-lock.json "$context/"
cp miniprogram/package.json "$context/miniprogram/"
cp server/package.json server/tsconfig.json server/nest-cli.json "$context/server/"
cp -R server/src "$context/server/"
cp deploy/Dockerfile "$context/Dockerfile"
docker buildx build --platform "$platform" --pull --load -t "$image" "$context"
actual_platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")
[[ $actual_platform == "$platform" ]] || { echo 'Built image architecture does not match target'; exit 1; }
docker save -o "$stage/image.tar" "$image"
image_id=$(node deploy/image-config-id.mjs "$stage/image.tar" "$image")
[[ $image_id =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Invalid image config ID'; exit 1; }
gzip "$stage/image.tar"
cp deploy/activate-image.sh "$stage/activate-image.sh"
cp deploy/verify-image.sh "$stage/verify-image.sh"
(cd "$stage" && shasum -a 256 image.tar.gz server.env activate-image.sh verify-image.sh > SHA256SUMS)
remote=$(ssh "${ssh_opts[@]}" "$target" 'umask 077; mktemp -d /tmp/ytc-tool-upload.XXXXXXXX')
[[ $remote =~ ^/tmp/ytc-tool-upload\.[a-zA-Z0-9]+$ ]] || { echo 'Unexpected remote upload directory'; exit 1; }
echo 'Uploading image and protected environment file...'
scp -P "$ssh_port" -o "ControlPath=$stage/ssh.sock" "$stage/image.tar.gz" "$stage/server.env" "$stage/activate-image.sh" "$stage/verify-image.sh" "$stage/SHA256SUMS" "$target:$remote/"
# Every interpolated remote argument has a restricted alphabet, including the generated image ID.
ssh "${ssh_opts[@]}" "$target" "${privilege}bash '$remote/activate-image.sh' '$remote' '$version' '$port' '$image_id' '$platform'"
echo "Remote deployment finished. 1Panel upstream: http://127.0.0.1:$port"
