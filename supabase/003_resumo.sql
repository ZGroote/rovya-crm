-- configurações internas (sem política RLS: só o service role / cron leem)
create table if not exists public.crm_config(chave text primary key, valor text not null);
alter table public.crm_config enable row level security;
insert into public.crm_config(chave,valor) values ('cron_key', encode(extensions.gen_random_bytes(24),'hex')) on conflict (chave) do nothing;
create extension if not exists pg_cron;
create extension if not exists pg_net;
