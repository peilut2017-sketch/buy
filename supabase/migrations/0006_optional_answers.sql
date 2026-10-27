-- A review needs the product's details (colour, size, as the store lists them), stars and text. The category questions
-- (fit, photo match, value, recommend, usual size) are optional: people answer them when they want to.
update public.category_questions set required = false where required;

-- The purchase month is optional too. The constraint that demanded it for every unverified published review goes.
-- (Its name is generated, so it is found by what it checks.)
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.reviews'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%purchase_month IS NOT NULL%' and pg_get_constraintdef(oid) ilike '%verified%'
      and pg_get_constraintdef(oid) ilike '%body IS NULL%'
  loop
    execute format('alter table public.reviews drop constraint %I', c);
  end loop;
end $$;

-- The store's order list has no delivery date. An assumed one (a week after the order) is marked as such.
alter table public.orders add column delivery_estimated boolean not null default false;
