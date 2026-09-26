alter table public.leads add column if not exists tags text[] not null default '{}';

alter table public.leads drop constraint if exists leads_tags_known;
alter table public.leads
  add constraint leads_tags_known
  check (tags <@ array['Scooty', 'Lithium battery', 'Acid battery', 'Parts']::text[]);
