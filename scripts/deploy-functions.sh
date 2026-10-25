#!/usr/bin/env bash
# Deploys every Edge Function in supabase/functions to the linked Supabase project.
# Prerequisites: `supabase login` and `supabase link --project-ref <ref>` (see docs/11-trial-run.md).
set -euo pipefail
cd "$(dirname "$0")/../supabase"
for dir in functions/*/; do
  name="$(basename "$dir")"
  [ "$name" = "_shared" ] && continue
  flags=()
  # Telegram does not send a JWT; the function checks its own webhook secret.
  [ "$name" = "telegram-webhook" ] && flags+=(--no-verify-jwt)
  echo "== $name"
  supabase functions deploy "$name" "${flags[@]}"
done
