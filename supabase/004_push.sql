-- aparelhos inscritos para receber notificações do CRM
create table if not exists public.crm_push(
  endpoint text primary key,
  inscricao jsonb not null,
  criado_em timestamptz not null default now());
alter table public.crm_push enable row level security;
drop policy if exists admin_tudo on public.crm_push;
create policy admin_tudo on public.crm_push for all to authenticated using (public.is_admin()) with check (public.is_admin());
