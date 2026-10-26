-- Acceptance of the terms of use at sign-up. The terms cover reviews, price tracking, and the automatic reading of
-- product pages and of the person's own order page, so the server records which version each person accepted and when.
-- Written only by the accept-terms Edge Function (the column is not in the client's update grant).

alter table public.profiles
  add column terms_accepted_at timestamptz,
  add column terms_version text;

-- Everyone who signed up before this migration has to accept once; there is no silent consent.

-- Direct writes from the client (watches and "helpful" votes do not go through an Edge Function) need the same consent.
-- The database only checks that some version was accepted; the Edge Functions compare it with the current one.
create or replace function public.has_accepted_terms()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and terms_version is not null);
$$;
revoke execute on function public.has_accepted_terms() from public, anon;
grant execute on function public.has_accepted_terms() to authenticated;

drop policy "own watches" on public.watches;
create policy "own watches read" on public.watches for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own watches write" on public.watches for insert to authenticated
  with check (user_id = (select auth.uid()) and public.has_accepted_terms());
create policy "own watches update" on public.watches for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.has_accepted_terms());
create policy "own watches delete" on public.watches for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy "helpful vote" on public.helpful_votes;
create policy "helpful vote" on public.helpful_votes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.has_accepted_terms()
    and exists (select 1 from public.reviews r
                where r.id = review_id and r.user_id <> (select auth.uid())
                  and r.status = 'visible' and r.body is not null));
