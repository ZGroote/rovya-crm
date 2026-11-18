-- Agenda pública (rovyacreative.com.br/agendar): quem chega pelo site escolhe um horário livre dentro dos
-- períodos que a Sabrina reservou para novos clientes. A função crm-agendar (sem login) grava aqui com a chave de serviço;
-- o índice único impede duas pessoas no mesmo horário.
create table if not exists public.crm_agendamentos(
  id uuid primary key default gen_random_uuid(),
  inicio timestamptz not null, fim timestamptz not null,
  nome text not null, email text not null, telefone text, empresa text, mensagem text,
  cliente_id uuid references public.crm_clientes on delete set null,
  evento_id text, ip text,
  status text not null default 'confirmado' check (status in ('confirmado','cancelado')),
  criado_em timestamptz not null default now());
create unique index if not exists crm_agend_horario on public.crm_agendamentos(inicio) where status = 'confirmado';
create index if not exists crm_agend_cliente on public.crm_agendamentos(cliente_id);
alter table public.crm_agendamentos enable row level security;
drop policy if exists admin_tudo on public.crm_agendamentos;
create policy admin_tudo on public.crm_agendamentos for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists crm_mfa on public.crm_agendamentos;
create policy crm_mfa on public.crm_agendamentos as restrictive for all to authenticated using (public.crm_aal_ok()) with check (public.crm_aal_ok());

-- quais agendas do Google o CRM usa: {profissional, pessoal, mostrar:[ids]} (só a função crm-google lê/grava)
alter table public.crm_google add column if not exists agendas jsonb not null default '{}';
-- escopos que o Google deu na última conexão (o CRM mostra "Reconectar" quando falta algum)
alter table public.crm_google add column if not exists escopos text;

-- registro de alterações (crm_log), como as outras tabelas do CRM
drop trigger if exists crm_log on public.crm_agendamentos;
create trigger crm_log after insert or update or delete on public.crm_agendamentos for each row execute function public.crm_log_trg();
