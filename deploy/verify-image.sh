#!/usr/bin/env bash
# Config digest is portable between classic Docker and containerd image stores.
set -euo pipefail
[[ $# == 2 && $2 =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1
image=$1 expected=$2
actual=$(docker image inspect --format '{{.Id}}' "$image")
[[ $actual != "$expected" ]] || exit 0
# containerd can report an index/manifest ID; verify the config bytes in its export.
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
docker save -o "$stage/image.tar" "$image"
hex=${expected#sha256:}
found=false
for entry in "$hex.json" "blobs/sha256/$hex"; do
 if tar -xOf "$stage/image.tar" "$entry" > "$stage/config.json" 2>/dev/null; then found=true; break; fi
done
$found || { echo "Image identity mismatch: expected config $expected; engine ID $actual" >&2; exit 1; }
if command -v sha256sum >/dev/null; then sum=$(sha256sum "$stage/config.json"); else sum=$(shasum -a 256 "$stage/config.json"); fi
[[ ${sum%% *} == "$hex" ]] || { echo 'Loaded image config checksum mismatch' >&2; exit 1; }
