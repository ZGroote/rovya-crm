-- Portal do cliente (rovyacreative.com.br/portal), fase 1.
-- O cliente entra com e-mail e senha (Supabase Auth), mas NUNCA lê as tabelas do CRM: as políticas de hoje continuam
-- só para admin + MFA. A função crm-portal confere quem está logado nesta tabela e devolve só os dados do cliente dele.
-- Só acrescenta: nenhuma linha existente muda.

-- quem entra no portal de qual cliente (um login vê um cliente; um cliente pode ter mais de um login)
create table if not exists public.crm_portal(
  user_id uuid primary key references auth.users on delete cascade,
  cliente_id uuid not null references public.crm_clientes on delete cascade,
  email text not null,
  criado_em timestamptz not null default now(),
  ultimo_acesso timestamptz);
create index if not exists crm_portal_cliente on public.crm_portal(cliente_id);
alter table public.crm_portal enable row level security;
drop policy if exists admin_tudo on public.crm_portal;
create policy admin_tudo on public.crm_portal for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists crm_mfa on public.crm_portal;
create policy crm_mfa on public.crm_portal as restrictive for all to authenticated using (public.crm_aal_ok()) with check (public.crm_aal_ok());

-- derruba as sessões abertas de um login (senha nova, ou e-mail que já tinha conta antes de virar acesso do portal).
-- Só a função crm-portal (service role) chama.
create or replace function public.crm_portal_sair(p_user uuid) returns void
language sql security definer set search_path = '' as $$ delete from auth.sessions where user_id = p_user; $$;
revoke all on function public.crm_portal_sair(uuid) from public, anon, authenticated;
grant execute on function public.crm_portal_sair(uuid) to service_role;

-- estratégia de marca que o cliente consulta (texto com ## título e **negrito**, como os documentos dos planos)
alter table public.crm_clientes add column if not exists estrategia text;

-- tarefas que vieram do portal (pedido de ajuste ou nova demanda): o cliente acompanha o andamento delas
alter table public.crm_tarefas add column if not exists origem text;
create index if not exists crm_tarefa_cliente_origem on public.crm_tarefas(cliente_id, origem);
