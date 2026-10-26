#!/usr/bin/env bash
# Deploys every Edge Function in supabase/functions to the linked Supabase project.
# Prerequisites: `supabase login` and `supabase link --project-ref <ref>` (see docs/11-trial-run.md).
set -euo pipefail
cd "$(dirname "$0")/../supabase"
for dir in functions/*/; do
  name="$(basename "$dir")"
  [ "$name" = "_shared" ] && continue
  flags=()
  # Without `supabase link` (for example in CI) the project comes from SUPABASE_PROJECT_REF.
  [ -n "${SUPABASE_PROJECT_REF:-}" ] && flags+=(--project-ref "$SUPABASE_PROJECT_REF")
  # Telegram does not send a JWT; the function checks its own webhook secret.
  [ "$name" = "telegram-webhook" ] && flags+=(--no-verify-jwt)
  echo "== $name"
  supabase functions deploy "$name" ${flags[@]+"${flags[@]}"}
done
