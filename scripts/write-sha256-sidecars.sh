#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <summary-file> <artifact>..." >&2
  exit 1
fi

summary_file="$1"
shift

mkdir -p "$(dirname "${summary_file}")"
: > "${summary_file}"

for artifact in "$@"; do
  if [[ ! -f "${artifact}" ]]; then
    echo "artifact not found: ${artifact}" >&2
    exit 1
  fi

  digest="$(sha256sum "${artifact}" | awk '{print $1}')"
  basename="$(basename "${artifact}")"
  printf '%s  %s\n' "${digest}" "${basename}" >> "${summary_file}"
  printf '%s  %s\n' "${digest}" "${basename}" > "${artifact}.sha256"
done
