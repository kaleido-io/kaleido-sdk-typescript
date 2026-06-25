#!/usr/bin/env bash
# Upload custom-snippet-handler implementations to artifact-registry.
#
# Each handlers/*.ts file (excluding *.test.ts) is uploaded as ?type=typescript
# to: namespaces/$AREG_NS_FILE/repositories/<name>/files/$AREG_TAG
#
# Repository name defaults to the handler basename (hello.ts → hello).
#
# Usage:
#   source scripts/env.example   # edit values first
#   bash scripts/upload-handlers.sh
#
# Requires: curl, jq

set -euo pipefail

: "${AREG_API:?set AREG_API, e.g. http://localhost:5600/api/v1}"
: "${AREG_USER:?set AREG_USER}"
: "${AREG_PASSWORD:?set AREG_PASSWORD}"

AREG_API="${AREG_API%/}"
if [[ "${AREG_API}" == */rest && "${AREG_API}" != */api/v1 ]]; then
  AREG_API="${AREG_API}/api/v1"
fi

AREG_NS_FILE="${AREG_NS_FILE:-platform-files-demo}"
AREG_TAG="${AREG_TAG:-1.0.0}"
AREG_REPO_PREFIX="${AREG_REPO_PREFIX:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SAMPLE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
HANDLERS_DIR="${AREG_HANDLERS_DIR:-${SAMPLE_DIR}/handlers}"

auth_args=(-u "${AREG_USER}:${AREG_PASSWORD}")
if [[ -n "${AREG_TOKEN:-}" ]]; then
  auth_args=(-H "Authorization: Bearer ${AREG_TOKEN}")
fi

curl_args=(-sS)
if [[ "${AREG_INSECURE:-}" == "1" || "${AREG_INSECURE:-}" == "true" ]]; then
  curl_args+=(-k)
fi

curl_json() {
  curl "${curl_args[@]}" "${auth_args[@]}" -H "Content-Type: application/json" "$@"
}

curl_upload_ts() {
  local url="$1"
  local file="$2"
  curl "${curl_args[@]}" "${auth_args[@]}" -H "Content-Type: text/plain" --data-binary "@${file}" "${url}"
}

ensure_namespace() {
  local name="$1"
  local family="$2"
  local tmp code body

  tmp="$(mktemp)"
  code="$(curl "${curl_args[@]}" "${auth_args[@]}" -o "${tmp}" -w "%{http_code}" \
    "${AREG_API}/namespaces/${name}")"
  if [[ "${code}" == "200" ]]; then
    echo "(already exists)"
    jq . "${tmp}"
    rm -f "${tmp}"
    return 0
  fi
  rm -f "${tmp}"

  body="$(curl_json -X POST "${AREG_API}/namespaces" \
    -d "{\"name\":\"${name}\",\"artifactFamily\":\"${family}\"}")"
  if echo "${body}" | jq -e '.name' >/dev/null 2>&1; then
    echo "${body}" | jq .
    return 0
  fi
  if echo "${body}" | grep -qE 'already exists|duplicate key'; then
    echo "(already exists)"
    curl_json "${AREG_API}/namespaces/${name}" | jq .
    return 0
  fi
  echo "${body}" | jq .
  return 1
}

ensure_repository() {
  local ns="$1"
  local repo="$2"
  local tmp code body

  tmp="$(mktemp)"
  code="$(curl "${curl_args[@]}" "${auth_args[@]}" -o "${tmp}" -w "%{http_code}" \
    "${AREG_API}/namespaces/${ns}/repositories/${repo}")"
  if [[ "${code}" == "200" ]]; then
    echo "(already exists)"
    jq . "${tmp}"
    rm -f "${tmp}"
    return 0
  fi
  rm -f "${tmp}"

  body="$(curl_json -X POST "${AREG_API}/namespaces/${ns}/repositories" \
    -d "{\"name\":\"${repo}\"}")"
  if echo "${body}" | jq -e '.name' >/dev/null 2>&1; then
    echo "${body}" | jq .
    return 0
  fi
  if echo "${body}" | grep -qE 'already exists|duplicate key'; then
    echo "(already exists)"
    curl_json "${AREG_API}/namespaces/${ns}/repositories/${repo}" | jq .
    return 0
  fi
  echo "${body}" | jq .
  return 1
}

handler_files=()
while IFS= read -r -d '' file; do
  handler_files+=("${file}")
done < <(find "${HANDLERS_DIR}" -maxdepth 1 -type f -name '*.ts' ! -name '*.test.ts' -print0 | sort -z)

if [[ ${#handler_files[@]} -eq 0 ]]; then
  echo "No handler .ts files found in ${HANDLERS_DIR}" >&2
  exit 1
fi

echo "== Health =="
curl_json "${AREG_API}/health" | jq .

echo
echo "== Create file namespace (${AREG_NS_FILE}) =="
ensure_namespace "${AREG_NS_FILE}" file

echo
echo "== Upload handlers from ${HANDLERS_DIR} (tag: ${AREG_TAG}) =="

for file in "${handler_files[@]}"; do
  base="$(basename "${file}" .ts)"
  repo="${AREG_REPO_PREFIX}${base}"

  echo
  echo "-- ${base} → ${AREG_NS_FILE}/${repo}:${AREG_TAG} --"
  ensure_repository "${AREG_NS_FILE}" "${repo}"
  curl_upload_ts \
    "${AREG_API}/namespaces/${AREG_NS_FILE}/repositories/${repo}/files/${AREG_TAG}?type=typescript" \
    "${file}" | jq .
done

echo
echo "== List uploaded repositories =="
for file in "${handler_files[@]}"; do
  base="$(basename "${file}" .ts)"
  repo="${AREG_REPO_PREFIX}${base}"
  echo
  echo "-- ${repo} tags --"
  curl_json "${AREG_API}/namespaces/${AREG_NS_FILE}/repositories/${repo}/files" | jq .
done

echo
echo "Done. Uploaded ${#handler_files[@]} handler(s) to ${AREG_NS_FILE} with tag ${AREG_TAG}."
