-- Etapa 5 do Manual Mestre: produção (peças, formatos, revisões, aprovação), encerramento de projeto e falhas de integração.

-- 1) Produção: cada entrega é uma peça, com formato, contagem de revisões e data de aprovação.
alter table public.crm_entregas
  add column if not exists formato text,
  add column if not exists revisoes int not null default 0,
  add column if not exists aprovado_em timestamptz;

-- contador de revisões e data de aprovação acompanham o status que a Sabrina escolhe (o trigger não muda o status)
create or replace function public.crm_entrega_trg() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'revisao' then new.revisoes := old.revisoes + 1; end if;
    new.aprovado_em := case when new.status = 'aprovado' then now() end;
  end if;
  return new;
end $$;
drop trigger if exists crm_entrega on public.crm_entregas;
create trigger crm_entrega before update on public.crm_entregas for each row execute function public.crm_entrega_trg();
update public.crm_entregas set aprovado_em = atualizado_em where status = 'aprovado' and aprovado_em is null;

-- 2) Encerramento: arquivar só por comando, guardando quando e a classificação de retenção
alter table public.crm_projetos drop constraint if exists crm_projetos_status_check;
alter table public.crm_projetos add constraint crm_projetos_status_check check (status in ('ativo','pausado','concluido','arquivado'));
alter table public.crm_projetos
  add column if not exists arquivado_em date,
  add column if not exists retencao text;

-- 3) Falhas de integração (Drive, Google Agenda, Assistente): o CRM registra, a Sabrina marca como resolvida
create table if not exists public.crm_falhas(
  id bigint generated always as identity primary key,
  quando timestamptz not null default now(),
  origem text not null, acao text, mensagem text not null,
  resolvida boolean not null default false);
create index if not exists crm_falhas_quando on public.crm_falhas(quando desc);
alter table public.crm_falhas enable row level security;
drop policy if exists admin_tudo on public.crm_falhas;
create policy admin_tudo on public.crm_falhas for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists crm_mfa on public.crm_falhas;
create policy crm_mfa on public.crm_falhas as restrictive for all to authenticated using (public.crm_aal_ok()) with check (public.crm_aal_ok());
