-- Smoke tests for 0001_init.sql: access control, constraints and triggers.
-- Everything runs in one transaction that is rolled back, so the database is left untouched.
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_smoke.sql
-- A failing assert aborts with its message. All test data below is synthetic.

\set ON_ERROR_STOP on
begin;

-- Users: alice and bob are regular, mia moderates, adam administers.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'alice@test.invalid'),
  ('b0000000-0000-0000-0000-000000000002', 'bob@test.invalid'),
  ('c0000000-0000-0000-0000-000000000003', 'mia@test.invalid'),
  ('d0000000-0000-0000-0000-000000000004', 'adam@test.invalid');
update public.profiles set role = 'moderator' where id = 'c0000000-0000-0000-0000-000000000003';
update public.profiles set role = 'admin' where id = 'd0000000-0000-0000-0000-000000000004';

-- Catalogue and reviews written the way an Edge Function would (as the table owner).
insert into public.products (id, site_id, parent_sku, name, product_type) overriding system value values
  (1, 'terminalx', 'w000001', 'Test product one', 'apparel'),
  (2, 'terminalx', 'w000002', 'Test product two', 'apparel'),
  (3, 'terminalx', 'w000003', 'Test product three', 'apparel'),
  (4, 'terminalx', 'w000004', 'Test product four', 'apparel');
insert into public.variants (id, product_id, sku, attributes) overriding system value values
  (1, 1, 'w0000010001', '{"מידה":"M"}');
insert into public.reviews (id, user_id, product_id, rating, body, purchase_month, answers, status) overriding system value values
  (1, 'b0000000-0000-0000-0000-000000000002', 1, 4, repeat('b', 40), '2026-09-01', '{"fit":"small"}', 'visible'),
  (2, 'b0000000-0000-0000-0000-000000000002', 2, 5, repeat('b', 40), '2026-09-01', '{"fit":"exact"}', 'hidden'),
  (3, 'a0000000-0000-0000-0000-000000000001', 3, 3, null,            null,         '{}',               'visible');

-- ---------------------------------------------------------------- signup
do $$
begin
  assert (select count(*) from public.profiles) = 4, 'a profile is created for every new auth user';
end $$;

do $$
declare alice constant uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  assert (select display_name is null from public.profiles where id = alice), 'nickname starts empty, real name is never copied';
  assert (select count(*) from public.notification_prefs where user_id = alice) = 9, 'nine notification kinds are seeded';
  assert (select enabled from public.notification_prefs where user_id = alice and kind = 'price_drop') = false, 'price_drop defaults off (spec 14)';
  assert (select enabled from public.notification_prefs where user_id = alice and kind = 'moderation_decision') = true, 'moderation_decision defaults on (spec 14)';
  assert (select count(*) from public.notification_channels where user_id = alice and channel = 'extension') = 1, 'extension channel exists';
  assert exists (select 1 from public.reviewer_stats where user_id = alice), 'stats row exists';
end $$;

-- ---------------------------------------------------------------- profiles are private
do $$
declare
  alice constant uuid := 'a0000000-0000-0000-0000-000000000001';
  bob   constant uuid := 'b0000000-0000-0000-0000-000000000002';
  n int;
begin
  perform set_config('request.jwt.claim.sub', alice::text, true);
  set local role authenticated;

  update public.profiles set display_name = 'alice_a' where id = alice;
  get diagnostics n = row_count;
  assert n = 1, 'a user can set their own nickname';

  begin
    update public.profiles set role = 'admin' where id = alice;
    assert false, 'a user must not be able to change their own role';
  exception when insufficient_privilege then null; end;

  begin
    update public.profiles set blocked_at = null where id = alice;
    assert false, 'a user must not be able to touch blocked_at';
  exception when insufficient_privilege then null; end;

  update public.profiles set display_name = 'hijacked' where id = bob;
  get diagnostics n = row_count;
  assert n = 0, 'a user cannot edit someone else''s profile';

  assert (select count(*) from public.profiles) = 1, 'a user sees only their own profile row';

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin
    perform 1 from public.profiles;
    assert false, 'anon must have no access to profiles';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

do $$
declare cols text[];
begin
  assert exists (select 1 from public.reviewer_public where display_name = 'alice_a'), 'reviewer_public shows a user once they have a nickname';
  assert not exists (select 1 from public.reviewer_public where display_name is null), 'users without a nickname are not public';
  select array_agg(column_name::text order by column_name) into cols
    from information_schema.columns where table_schema = 'public' and table_name = 'reviewer_public';
  assert cols = array['display_name','helpful_received','level','reviews_count','user_id','verified_count'],
    'reviewer_public exposes only the public columns, got ' || cols::text;
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  assert (select count(*) from public.reviewer_public) = 1, 'anon can read reviewer_public';
  begin
    perform 1 from public.reviewer_stats;
    assert false, 'anon must not read reviewer_stats';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- ---------------------------------------------------------------- reviews visibility and helpful votes
do $$
declare
  alice constant uuid := 'a0000000-0000-0000-0000-000000000001';
  bob   constant uuid := 'b0000000-0000-0000-0000-000000000002';
  mia   constant uuid := 'c0000000-0000-0000-0000-000000000003';
begin
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  assert (select count(*) from public.reviews) = 1, 'anon sees only visible reviews that have text';
  reset role;

  perform set_config('request.jwt.claim.sub', bob::text, true);
  set local role authenticated;
  assert (select count(*) from public.reviews) = 2, 'an author also sees their own hidden review';
  reset role;

  perform set_config('request.jwt.claim.sub', alice::text, true);
  set local role authenticated;
  assert (select count(*) from public.reviews) = 2, 'alice sees the public review plus her own quick rating';
  reset role;

  perform set_config('request.jwt.claim.sub', mia::text, true);
  set local role authenticated;
  assert (select count(*) from public.reviews) = 3, 'a moderator sees every review';
  reset role;
end $$;

do $$
declare
  alice constant uuid := 'a0000000-0000-0000-0000-000000000001';
  bob   constant uuid := 'b0000000-0000-0000-0000-000000000002';
begin
  perform set_config('request.jwt.claim.sub', alice::text, true);
  set local role authenticated;

  insert into public.helpful_votes (review_id, user_id) values (1, alice);
  reset role;
  assert (select helpful_count from public.reviews where id = 1) = 1, 'a vote raises helpful_count';

  set local role authenticated;
  begin
    insert into public.helpful_votes (review_id, user_id) values (1, alice);
    assert false, 'a second vote must be rejected';
  exception when unique_violation then null; end;

  begin
    insert into public.helpful_votes (review_id, user_id) values (2, alice);
    assert false, 'no votes on a hidden review';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.helpful_votes (review_id, user_id) values (1, bob);
    assert false, 'no voting on behalf of someone else';
  exception when insufficient_privilege then null; end;

  delete from public.helpful_votes where review_id = 1 and user_id = alice;
  reset role;
  assert (select helpful_count from public.reviews where id = 1) = 0, 'removing a vote lowers helpful_count';

  perform set_config('request.jwt.claim.sub', bob::text, true);
  set local role authenticated;
  begin
    insert into public.helpful_votes (review_id, user_id) values (1, bob);
    assert false, 'authors cannot vote on their own review';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- ---------------------------------------------------------------- review constraints
do $$
declare alice constant uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  begin
    insert into public.reviews (user_id, product_id, rating, body, verification) values (alice, 4, 5, repeat('x', 40), 'unverified');
    assert false, 'unverified review text requires a purchase month';
  exception when check_violation then null; end;
  begin
    insert into public.reviews (user_id, product_id, rating, body, purchase_month) values (alice, 4, 5, repeat('x', 40), '2026-09-15');
    assert false, 'purchase_month must be the first day of a month';
  exception when check_violation then null; end;
  begin
    insert into public.reviews (user_id, product_id, rating, body, verification) values (alice, 4, 5, repeat('x', 40), 'verified');
    assert false, 'a verified review needs an order item';
  exception when check_violation then null; end;
  begin
    insert into public.reviews (user_id, product_id, rating, body, purchase_month, answers)
      values (alice, 4, 5, repeat('x', 40), '2026-09-01', '{"fit":"true"}');
    assert false, 'fit must be small, exact or large';
  exception when check_violation then null; end;
  begin
    insert into public.reviews (user_id, product_id, rating, body, purchase_month) values (alice, 4, 5, 'too short', '2026-09-01');
    assert false, 'text under 30 characters is rejected';
  exception when check_violation then null; end;
  begin
    insert into public.reviews (user_id, product_id, rating, purchase_month) values (alice, 1, 5, '2026-09-01');
    insert into public.reviews (user_id, product_id, rating, purchase_month) values (alice, 1, 4, '2026-09-01');
    assert false, 'one review per user per parent product';
  exception when unique_violation then null; end;
end $$;

do $$
declare r public.reviews;
begin
  r.written_at := '2026-02-01 10:00+00'; r.delivered_at := '2026-01-27';
  assert public.review_stage(r) = 'first_impression', 'five days after delivery is a first impression';
  r.written_at := '2026-03-01 10:00+00'; r.delivered_at := '2026-01-27';
  assert public.review_stage(r) = 'after_use', 'about a month after delivery is after use';
  r.written_at := '2026-07-01 10:00+00'; r.delivered_at := '2026-01-27';
  assert public.review_stage(r) = 'long_term', 'more than three months is long term';
  r.delivered_at := null; r.purchased_at := null; r.purchase_month := null;
  assert public.review_stage(r) is null, 'no purchase date gives no stage';
end $$;

-- ---------------------------------------------------------------- reviewer levels
do $$
declare
  bob constant uuid := 'b0000000-0000-0000-0000-000000000002';
  mia constant uuid := 'c0000000-0000-0000-0000-000000000003';
begin
  perform set_config('request.jwt.claim.sub', '', true);   -- service-role work, no signed-in user
  -- bob has one visible review (id 1) and one hidden. Add a third visible one that is too fresh to count.
  insert into public.reviews (user_id, product_id, rating, body, purchase_month, written_at)
    values (bob, 3, 4, repeat('b', 40), '2026-09-01', now());
  update public.reviews set written_at = now() - interval '3 days' where id = 1;
  perform public.recompute_reviewer_stats(bob);
  assert (select reviews_count from public.reviewer_stats where user_id = bob) = 1, 'a review under 48 hours old does not count yet';
  assert (select level from public.reviewer_stats where user_id = bob) = 'new', 'one review is still level new';

  update public.reviews set written_at = now() - interval '3 days' where user_id = bob;
  update public.reviews set status = 'visible' where id = 2;
  perform public.recompute_reviewer_stats(bob);
  assert (select reviews_count from public.reviewer_stats where user_id = bob) = 3, 'three aged visible reviews count';
  assert (select level from public.reviewer_stats where user_id = bob) = 'active', 'three reviews make level active';

  update public.settings set value = jsonb_set(value, '{active}', '5') where key = 'level_thresholds';
  perform public.recompute_reviewer_stats(null);
  assert (select level from public.reviewer_stats where user_id = bob) = 'new', 'thresholds come from settings';

  set local role authenticated;
  begin
    perform public.recompute_reviewer_stats(bob);
    assert false, 'clients must not call recompute_reviewer_stats';
  exception when insufficient_privilege then null; end;
  reset role;
  update public.reviews set status = 'hidden' where id = 2;
end $$;

-- ---------------------------------------------------------------- prices and events
do $$
declare cols text[];
begin
  insert into public.price_events (variant_id, price, source, install_hash) values (1, 149.90, 'user_report', 'hash-1');
  set local role authenticated;
  begin
    perform 1 from public.price_events;
    assert false, 'clients must not read price_events (install_hash)';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.price_history) = 1, 'price_history is readable';
  reset role;
  select array_agg(column_name::text) into cols
    from information_schema.columns where table_schema = 'public' and table_name = 'price_history';
  assert not ('install_hash' = any(cols)), 'price_history omits install_hash';
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  assert (select count(*) from public.price_history) = 1, 'anon can read price_history';
  reset role;

  begin
    insert into public.events (event, platform, install_id) values ('product_view', 'extension', 'inst-1');
    assert false, 'a product view must not carry an install id';
  exception when check_violation then null; end;
  begin
    insert into public.events (event, platform, user_id) values ('product_view', 'web_desktop', 'a0000000-0000-0000-0000-000000000001');
    assert false, 'a product view must not carry a user id';
  exception when check_violation then null; end;
  insert into public.events (event, platform, product_id) values ('product_view', 'extension', 1);
  insert into public.events (event, platform, install_id) values ('first_product_view', 'extension', 'inst-1');
  begin
    insert into public.events (event, platform) values ('page_scrape', 'extension');
    assert false, 'unknown event names are rejected';
  exception when check_violation then null; end;
end $$;

-- ---------------------------------------------------------------- watches, channels, prefs, pending reviews, orders
do $$
declare
  alice constant uuid := 'a0000000-0000-0000-0000-000000000001';
  bob   constant uuid := 'b0000000-0000-0000-0000-000000000002';
  n int;
begin
  insert into public.orders (id, user_id, site_id, order_hash, source) overriding system value
    values (1, alice, 'terminalx', 'hash-order-a', 'extension'), (2, bob, 'terminalx', 'hash-order-b', 'extension');
  insert into public.order_items (id, order_id, product_id, variant_id, sku) overriding system value
    values (1, 1, 1, 1, 'w0000010001'), (2, 2, 1, 1, 'w0000010001');
  insert into public.pending_reviews (user_id, order_item_id, product_id, due_at)
    values (alice, 1, 1, now()), (bob, 2, 1, now());
  insert into public.notification_channels (user_id, channel, address, verified) values (alice, 'telegram', '99999', true);

  perform set_config('request.jwt.claim.sub', alice::text, true);
  set local role authenticated;

  assert (select count(*) from public.orders) = 1, 'a user sees only their own orders';
  assert (select count(*) from public.order_items) = 1, 'a user sees only their own order items';
  assert (select count(*) from public.pending_reviews) = 1, 'a user sees only their own pending reviews';

  insert into public.watches (user_id, product_id, variant_id, target_price) values (alice, 1, 1, 99.90);
  begin
    insert into public.watches (user_id, product_id, variant_id, target_price) values (alice, 1, 1, 80);
    assert false, 'only one watch per product and variant';
  exception when unique_violation then null; end;
  begin
    insert into public.watches (user_id, product_id) values (alice, 2);
    assert false, 'a watch needs a condition';
  exception when check_violation then null; end;
  begin
    insert into public.watches (user_id, product_id, target_price) values (bob, 2, 50);
    assert false, 'no watches on behalf of someone else';
  exception when insufficient_privilege then null; end;

  update public.notification_channels set enabled = false where user_id = alice and channel = 'telegram';
  get diagnostics n = row_count;
  assert n = 1, 'a user can switch a channel off';
  begin
    update public.notification_channels set verified = false where user_id = alice and channel = 'telegram';
    assert false, 'verified is not user-editable';
  exception when insufficient_privilege then null; end;
  begin
    update public.notification_channels set address = '12345' where user_id = alice and channel = 'telegram';
    assert false, 'address is not user-editable';
  exception when insufficient_privilege then null; end;

  update public.pending_reviews set dismissed = true where user_id = alice;
  get diagnostics n = row_count;
  assert n = 1, 'a user can dismiss a pending review';
  begin
    update public.pending_reviews set due_at = now() + interval '1 year' where user_id = alice;
    assert false, 'only dismissed is editable on pending reviews';
  exception when insufficient_privilege then null; end;

  begin
    update public.notification_prefs set channels = '{sms}' where user_id = alice and kind = 'restock';
    assert false, 'unknown channels are rejected';
  exception when check_violation then null; end;

  begin
    perform 1 from public.notification_queue;
    assert false, 'notification_queue is service only';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.telegram_link_tokens;
    assert false, 'telegram_link_tokens is service only';
  exception when insufficient_privilege then null; end;
  reset role;

  perform set_config('request.jwt.claim.sub', bob::text, true);
  set local role authenticated;
  assert (select count(*) from public.watches) = 0, 'a user cannot see someone else''s watches';
  reset role;
end $$;

-- ---------------------------------------------------------------- reports, appeals, flags
do $$
declare
  alice constant uuid := 'a0000000-0000-0000-0000-000000000001';
  bob   constant uuid := 'b0000000-0000-0000-0000-000000000002';
  mia   constant uuid := 'c0000000-0000-0000-0000-000000000003';
begin
  insert into public.reports (review_id, reporter_id, reason) values (1, alice, 'spam'), (1, mia, 'fake');
  insert into public.review_flags (review_id, reason) values (1, 'review_wave');
  insert into public.appeals (review_id, user_id, body) values (2, bob, 'please reconsider');

  perform set_config('request.jwt.claim.sub', alice::text, true);
  set local role authenticated;
  assert (select count(*) from public.reports) = 1, 'a reporter sees only their own reports';
  assert (select count(*) from public.appeals) = 0, 'alice does not see bob''s appeal';
  assert (select count(*) from public.review_flags) = 0, 'flags are for staff only';
  begin
    insert into public.reports (review_id, reporter_id, reason) values (2, alice, 'spam');
    assert false, 'reports are created by an Edge Function, not by clients';
  exception when insufficient_privilege then null; end;
  reset role;

  perform set_config('request.jwt.claim.sub', bob::text, true);
  set local role authenticated;
  assert (select count(*) from public.appeals) = 1, 'an author sees their own appeal';
  assert (select count(*) from public.takedown_requests) = 0, 'takedown requests are staff only';
  reset role;

  perform set_config('request.jwt.claim.sub', mia::text, true);
  set local role authenticated;
  assert (select count(*) from public.reports) = 2, 'a moderator sees every report';
  assert (select count(*) from public.review_flags) = 1, 'a moderator sees flags';
  assert (select count(*) from public.profiles) = 4, 'staff can list users';
  begin
    update public.reports set status = 'dismissed' where review_id = 1;
    assert false, 'decisions go through an Edge Function so they are audited';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- ---------------------------------------------------------------- catalogue, sites, settings
do $$
declare
  mia  constant uuid := 'c0000000-0000-0000-0000-000000000003';
  adam constant uuid := 'd0000000-0000-0000-0000-000000000004';
  n int; v int;
begin
  perform set_config('request.jwt.claim.sub', '', true);   -- setup below acts as the service role
  insert into public.global_products (id, gtin) overriding system value values (1, '7290000000001');
  insert into public.product_links (product_id, global_product_id, confidence, source, confirmed) values
    (1, 1, 'low', 'name', false), (2, 1, 'medium', 'name', false), (3, 1, 'low', 'community', true);
  insert into public.settings (key, value, is_public) values ('internal_only', '{"x":1}', false);
  update public.sites set status = 'paused' where id = 'terminalx';

  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  assert (select count(*) from public.product_links) = 2, 'low-confidence links stay hidden until confirmed, medium shows';
  assert (select count(*) from public.sites where status = 'paused') = 1, 'a paused site stays readable so clients can stop';
  assert (select count(*) from public.settings) = 6, 'only public settings are readable';
  assert (select count(*) from public.category_questions where product_type = 'apparel') = 5, 'apparel has five questions';
  assert (select count(*) from public.category_questions where product_type = 'footwear') = 5, 'footwear has five questions';
  assert (select count(*) from public.category_questions where product_type = 'general' and question_key = 'fit') = 0, 'general has no fit question';
  begin
    update public.sites set name = 'x';
    assert false, 'anon cannot edit sites';
  exception when insufficient_privilege then null; end;
  begin
    update public.settings set value = '{}';
    assert false, 'anon cannot edit settings';
  exception when insufficient_privilege then null; end;
  reset role;

  perform set_config('request.jwt.claim.sub', mia::text, true);
  set local role authenticated;
  update public.sites set adapter_config = '{"x":1}';
  get diagnostics n = row_count;
  assert n = 0, 'a moderator cannot edit sites';
  reset role;

  perform set_config('request.jwt.claim.sub', adam::text, true);
  set local role authenticated;
  select adapter_version into v from public.sites where id = 'terminalx';
  update public.sites set name = 'Terminal X (renamed)' where id = 'terminalx';
  assert (select adapter_version from public.sites where id = 'terminalx') = v, 'a rename does not bump adapter_version';
  update public.sites set adapter_config = '{"rules":1}' where id = 'terminalx';
  assert (select adapter_version from public.sites where id = 'terminalx') = v + 1, 'changing adapter_config bumps adapter_version';
  assert (select count(*) from public.settings) = 7, 'an admin sees private settings too';
  update public.settings set value = '{"x":2}' where key = 'internal_only';
  assert (select count(*) from public.admin_audit_log where target_type = 'sites') = 2, 'site edits are audited';
  assert (select count(*) from public.admin_audit_log where target_type = 'settings' and target_id = 'internal_only') = 1, 'settings edits are audited';
  assert (select count(*) from public.events) >= 1, 'an admin can read events';
  reset role;

  perform set_config('request.jwt.claim.sub', '', true);
  update public.sites set name = 'Terminal X' where id = 'terminalx';
  assert (select count(*) from public.admin_audit_log) = 3, 'service-role edits are not logged as admin actions';
end $$;

-- ---------------------------------------------------------------- blocked staff lose their powers
do $$
declare adam constant uuid := 'd0000000-0000-0000-0000-000000000004';
begin
  update public.profiles set blocked_at = now() where id = adam;
  perform set_config('request.jwt.claim.sub', adam::text, true);
  set local role authenticated;
  assert (select count(*) from public.events) = 0, 'a blocked admin has no admin rights';
  reset role;
end $$;

-- ---------------------------------------------------------------- product summary
do $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  assert (select reviews_count from public.product_summary where product_id = 1) = 1, 'summary counts public reviews';
  assert (select fit_small from public.product_summary where product_id = 1) = 1, 'summary counts fit answers';
  assert (select reviews_count from public.product_summary where product_id = 3) = 1, 'summary counts bob''s third review';
  assert (select rating_avg from public.product_summary where product_id = 2) is null, 'hidden review is excluded from the average';
  reset role;
end $$;

rollback;
\echo 'ALL SMOKE TESTS PASSED'
