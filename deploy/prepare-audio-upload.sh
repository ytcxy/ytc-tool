#!/usr/bin/env bash
# stdout is a machine-readable list of missing hash filenames; progress goes to stderr.
set -euo pipefail
stage=$1
[[ $stage =~ ^/tmp/ytc-audio-upload\.[a-zA-Z0-9]+$ ]] || exit 1
mkdir -p "$stage/bundle/files"
reused=0 missing=0
while IFS= read -r file; do
 [[ $file =~ ^[a-f0-9]{64}\.(wav|mp3)$ ]] || { echo 'Invalid audio filename' >&2; exit 1; }
 expected=${file%.*}
 found=false
 for candidate in "/opt/ytc-tool/audio/files/$file" /tmp/ytc-audio-upload.*/bundle/files/"$file"; do
  [[ -f $candidate && ! -L $candidate ]] || continue
  digest=$(sha256sum "$candidate"); [[ ${digest%% *} == "$expected" ]] || continue
  destination="$stage/bundle/files/$file"
  if [[ $candidate != "$destination" ]]; then
   cp "$candidate" "$destination.pending"
   digest=$(sha256sum "$destination.pending")
   [[ ${digest%% *} == "$expected" ]] || { rm -f "$destination.pending";continue; }
   mv "$destination.pending" "$destination"
  fi
  found=true;break
 done
 if $found;then reused=$((reused+1));else printf '%s\n' "$file";missing=$((missing+1));fi
done < "$stage/bundle/files.txt"
printf 'Audio files: reused %s, need upload %s\n' "$reused" "$missing" >&2
