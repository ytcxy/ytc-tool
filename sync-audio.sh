#!/usr/bin/env bash
# Local entry point: preview by default. No database credentials are uploaded.
set -euo pipefail
host='' ssh_port=22 database='' mode=plan accept=false
usage(){ echo 'Usage: bash sync-audio.sh --host HOST --database=ytc-tool-prod [--ssh-port 22] [--apply --accept-changes]'; }
while (($#)); do
 case "$1" in
  --host|--ssh-port) (($#>=2))||exit 1; key=$1; value=$2; shift 2; if [[ $key == --host ]];then host=$value;else ssh_port=$value;fi;;
  --database=ytc-tool|--database=ytc-tool-prod) [[ -z $database ]]||exit 1;database=${1#*=};shift;;
  --apply) mode=apply;shift;;
  --accept-changes) accept=true;shift;;
  --help) usage;exit 0;;
  *) usage;exit 1;;
 esac
done
[[ $host =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ && -n $database && $ssh_port =~ ^[0-9]{1,5}$ ]]||{ usage;exit 1; }
((10#$ssh_port>0 && 10#$ssh_port<=65535))||exit 1
if $accept && [[ $mode != apply ]];then echo '--accept-changes requires --apply';exit 1;fi
root=$(cd "$(dirname "$0")" && pwd);cd "$root"
for cmd in node ssh scp;do command -v "$cmd" >/dev/null||{ echo "Missing $cmd";exit 1; };done
umask 077
stage=$(mktemp -d /tmp/ytc-audio-sync.XXXXXXXX)
ssh_opts=(-p "$ssh_port" -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ControlMaster=auto -o ControlPersist=600 -o "ControlPath=$stage/ssh.sock")
connected=false
cleanup(){
 code=$?
 if $connected;then ssh "${ssh_opts[@]}" -O exit "root@$host" >/dev/null 2>&1 || true;fi
 rm -rf "$stage"
 exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
echo '[1/4] Validating and packaging local audio...'
node server/scripts/package-audio.mjs server/audio "$stage/bundle" plan
echo '[2/4] Connecting to server (password input is hidden)...'
connected=true
remote=$(ssh "${ssh_opts[@]}" "root@$host" 'umask 077; mktemp -d /tmp/ytc-audio-upload.XXXXXXXX')
[[ $remote =~ ^/tmp/ytc-audio-upload\.[a-zA-Z0-9]+$ ]]||exit 1
echo '[3/4] Checking uploaded files; only missing audio will be transferred...'
scp_opts=(-P "$ssh_port" -o "ControlPath=$stage/ssh.sock" -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
scp -r "${scp_opts[@]}" "$stage/bundle" "root@$host:$remote/"
if [[ $mode == apply ]];then
 ssh "${ssh_opts[@]}" "root@$host" bash -s -- "$remote" < deploy/prepare-audio-upload.sh > "$stage/missing.txt"
 node server/scripts/select-audio-upload.mjs server/audio "$stage/bundle" "$stage/missing.txt" "$stage/files"
 if [[ -s $stage/missing.txt ]];then
  scp -r "${scp_opts[@]}" "$stage/files" "root@$host:$remote/bundle/"
 else echo 'All audio files already uploaded; skipping audio transfer.';fi
fi
echo '[4/4] Upload complete. Checking files and database mappings on server...'
ssh "${ssh_opts[@]}" "root@$host" bash -s -- "$remote" "$database" "$mode" "$accept" <<'REMOTE'
set -euo pipefail
stage=$1 database=$2 mode=$3 accept=$4
[[ $stage =~ ^/tmp/ytc-audio-upload\.[a-zA-Z0-9]+$ && ( $database == ytc-tool || $database == ytc-tool-prod ) && ( $mode == plan || $mode == apply ) && ( $accept == true || $accept == false ) ]]||exit 1
[[ $EUID == 0 ]]||exit 1
remote_cleanup(){
 code=$?
 if ((code==0));then rm -rf "$stage";else echo "Update failed; uploaded files retained for retry: $stage" >&2;fi
 exit "$code"
}
trap remote_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
exec 9>/run/lock/ytc-tool-docker.lock
flock -n 9||{ echo 'Deployment/audio update already running';exit 1; }
image=$(docker inspect -f '{{.Config.Image}}' ytc-tool-api)
[[ $image =~ ^ytc-tool-api:[0-9]{8}T[0-9]{6}Z-[0-9]+$ ]]||{ echo 'Unexpected running image';exit 1; }
[[ $(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/audio"}}{{.Source}}:{{.RW}}{{end}}{{end}}' ytc-tool-api) == /opt/ytc-tool/audio:false ]]||{ echo 'Deploy the updated backend first: audio read-only mount missing';exit 1; }
args=("--database=$database")
[[ $mode != apply ]]||args+=(--apply)
[[ $accept != true ]]||args+=(--accept-changes)
# Root is used only by this short-lived importer to install 0644 files; API stays unprivileged/read-only.
docker run --rm --pull=never --user 0:0 --network host \
 --security-opt no-new-privileges:true --cap-drop ALL \
 --env-file /opt/ytc-tool/current/server.env \
 -e AUDIO_BUNDLE=/bundle -e AUDIO_DIR=/app/audio \
 --mount type=bind,source="$stage/bundle",target=/bundle,readonly \
 --mount type=bind,source="$stage/bundle/audio-schema.sql",target=/app/server/migrations/003_sentence_audio.sql,readonly \
 --mount type=bind,source=/opt/ytc-tool/audio,target=/app/audio \
 "$image" node scripts/sync-audio.mjs "${args[@]}"
REMOTE
if [[ $mode == apply ]];then echo 'Audio upload and database update completed.';else echo 'Audio preview completed; no database changes applied.';fi
