-- Etapa 4 do Manual Mestre: MFA obrigatório para quem ativou, trilha de auditoria e exportação.

-- 1) MFA: quem tem fator verificado só lê/escreve o CRM com sessão aal2 (padrão da documentação do Supabase).
--    Política RESTRITIVA: soma-se à admin_tudo (is_admin) sem mexer nela nem nas figurinhas.
create or replace function public.crm_aal_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select array[(select auth.jwt()->>'aal')] <@ (
    select case when count(id) > 0 then array['aal2'] else array['aal1','aal2'] end
    from auth.mfa_factors where user_id = (select auth.uid()) and status = 'verified');
$$;

do $$ declare t text; begin
  foreach t in array array['crm_clientes','crm_oportunidades','crm_projetos','crm_etapas','crm_entregas','crm_anexos','crm_parcelas','crm_modelos',
    'crm_servicos','crm_propostas','crm_contratos','crm_drive','crm_documentos','crm_tarefas','crm_interacoes','crm_push'] loop
    execute format('drop policy if exists crm_mfa on public.%I', t);
    execute format('create policy crm_mfa on public.%I as restrictive for all to authenticated using (public.crm_aal_ok()) with check (public.crm_aal_ok())', t);
  end loop; end $$;

-- arquivos do CRM no Storage (só o bucket crm-anexos; os outros buckets não mudam)
drop policy if exists crm_anexos_mfa on storage.objects;
create policy crm_anexos_mfa on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'crm-anexos' or public.crm_aal_ok()) with check (bucket_id <> 'crm-anexos' or public.crm_aal_ok());

-- data de fechamento (ganho/perdido) para os relatórios; atualizado_em muda a cada contato
alter table public.crm_oportunidades add column if not exists fechado_em timestamptz;
update public.crm_oportunidades set fechado_em = atualizado_em where etapa in ('ganho','perdido') and fechado_em is null;

-- 2) Trilha de auditoria: quem, quando, o quê (no update, só os campos que mudaram). Só leitura para a admin.
create table if not exists public.crm_log(
  id bigint generated always as identity primary key,
  quando timestamptz not null default now(), quem text,
  tabela text not null, registro text, acao text not null check (acao in ('INSERT','UPDATE','DELETE')),
  antes jsonb, depois jsonb);
create index if not exists crm_log_quando on public.crm_log(quando desc);
create index if not exists crm_log_registro on public.crm_log(registro);
alter table public.crm_log enable row level security;
drop policy if exists admin_le on public.crm_log;
create policy admin_le on public.crm_log for select to authenticated using (public.is_admin() and public.crm_aal_ok());
-- sem política de insert/update/delete: o navegador não altera nem apaga o log

create or replace function public.crm_log_trg() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
        d jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
        reg text := coalesce(d->>'id', a->>'id', d->>'chave', a->>'chave'); k text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(a) loop
      if a->k is not distinct from d->k then a := a - k; d := d - k; end if;
    end loop;
    if d = '{}'::jsonb then return null; end if;
  end if;
  insert into public.crm_log(quem, tabela, registro, acao, antes, depois)
  values (coalesce((select auth.jwt()->>'email'), current_user), tg_table_name, reg, tg_op, a, d);
  return null;
end $$;

do $$ declare t text; begin
  foreach t in array array['crm_clientes','crm_oportunidades','crm_projetos','crm_etapas','crm_entregas','crm_anexos','crm_parcelas','crm_modelos',
    'crm_servicos','crm_propostas','crm_contratos','crm_drive','crm_documentos','crm_tarefas','crm_interacoes'] loop
    execute format('drop trigger if exists crm_log on public.%I', t);
    execute format('create trigger crm_log after insert or update or delete on public.%I for each row execute function public.crm_log_trg()', t);
  end loop; end $$;
