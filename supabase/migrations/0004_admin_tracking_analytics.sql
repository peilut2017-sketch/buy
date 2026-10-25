-- Admin screens for tracking, notifications and analytics (spec 19), and the funnel step "first watch".

-- Staff read: the "tracking and notifications" screen counts watches and delivery results. Users keep reading only their own rows.
create policy "admin watches" on public.watches for select to authenticated
  using (public.has_role(array['admin']));
create policy "admin notification log" on public.notification_log for select to authenticated
  using (public.has_role(array['admin']));

-- Funnel: a watch created by anyone becomes one "watch_created" event. The event carries the user, like signup and
-- review_submitted do, because it is a step of that person's own journey and is not browsing history.
create or replace function public.log_watch_created()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.events (event, platform, site_id, product_id, user_id)
  select 'watch_created', 'server', p.site_id, p.id, new.user_id from public.products p where p.id = new.product_id;
  return new;
end $$;

create trigger watches_log_event
  after insert on public.watches
  for each row execute function public.log_watch_created();
revoke execute on function public.log_watch_created() from public, anon, authenticated;

-- Retention by weekly install cohort. The extension sends no identifier with a product view (privacy rule 7), so the
-- only activity that can be tied to an install is opening the panel. This is therefore a lower bound on real use:
-- someone who only glances at the strip is not counted as active.
-- security_invoker: the caller's rights apply, and `events` is readable by admins only.
create or replace view public.admin_retention with (security_invoker = true) as
with installs as (
  select install_id, min(occurred_at) as installed_at
  from public.events
  where event = 'install' and install_id is not null
  group by install_id
)
select date_trunc('week', i.installed_at)::date as cohort,
       count(*) as installs,
       count(*) filter (where exists (
         select 1 from public.events e where e.install_id = i.install_id and e.event = 'panel_open'
           and e.occurred_at >= i.installed_at + interval '7 days' and e.occurred_at < i.installed_at + interval '14 days')) as week_1,
       count(*) filter (where exists (
         select 1 from public.events e where e.install_id = i.install_id and e.event = 'panel_open'
           and e.occurred_at >= i.installed_at + interval '28 days' and e.occurred_at < i.installed_at + interval '35 days')) as week_4,
       count(*) filter (where exists (
         select 1 from public.events e where e.install_id = i.install_id and e.event = 'panel_open'
           and e.occurred_at >= i.installed_at + interval '84 days' and e.occurred_at < i.installed_at + interval '91 days')) as week_12
from installs i
group by 1
order by 1 desc;

revoke all on public.admin_retention from anon, authenticated;
grant select on public.admin_retention to authenticated;
