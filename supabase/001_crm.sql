-- CRM Rovya: tabelas crm_* no projeto rovya-stickers. Só quem está em public.admins lê/escreve.
create table if not exists public.crm_clientes(
  id uuid primary key default gen_random_uuid(),
  nome text not null, empresa text, email text, telefone text, instagram text, origem text, notas text,
  criado_em timestamptz not null default now());

create table if not exists public.crm_oportunidades(
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.crm_clientes on delete cascade,
  titulo text not null,
  etapa text not null default 'contato' check (etapa in ('contato','diagnostico','proposta','negociacao','ganho','perdido')),
  valor numeric(12,2), proximo_passo text, proximo_em date, motivo_perda text, notas text,
  ordem double precision not null default extract(epoch from now()),
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now());

create table if not exists public.crm_projetos(
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.crm_clientes on delete cascade,
  oportunidade_id uuid references public.crm_oportunidades on delete set null,
  nome text not null,
  status text not null default 'ativo' check (status in ('ativo','pausado','concluido')),
  inicio date default current_date, entrega_prevista date, valor numeric(12,2),
  criado_em timestamptz not null default now());

create table if not exists public.crm_etapas(
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.crm_projetos on delete cascade,
  ordem int not null default 0, titulo text not null, orientacao text);

create table if not exists public.crm_entregas(
  id uuid primary key default gen_random_uuid(),
  etapa_id uuid not null references public.crm_etapas on delete cascade,
  ordem int not null default 0, titulo text not null, texto text,
  status text not null default 'a_fazer' check (status in ('a_fazer','produzindo','enviado','revisao','aprovado')),
  prazo date, link text, atualizado_em timestamptz not null default now());

create table if not exists public.crm_anexos(
  id uuid primary key default gen_random_uuid(),
  entrega_id uuid not null references public.crm_entregas on delete cascade,
  nome text not null, caminho text not null, tamanho bigint,
  criado_em timestamptz not null default now());

create table if not exists public.crm_parcelas(
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.crm_projetos on delete cascade,
  descricao text, valor numeric(12,2) not null check (valor >= 0), vencimento date, pago_em date, forma text);

create table if not exists public.crm_modelos(
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('projeto','orientacao','contrato','termo','email','whatsapp','outro')),
  titulo text not null, corpo text, estrutura jsonb,
  criado_em timestamptz not null default now());

-- token do Google Agenda: sem política = invisível para o navegador; só a Edge Function (service role) lê.
create table if not exists public.crm_google(
  id int primary key default 1 check (id = 1),
  email text, refresh_token text, conectado_em timestamptz default now());

create index if not exists crm_op_cliente on public.crm_oportunidades(cliente_id);
create index if not exists crm_proj_cliente on public.crm_projetos(cliente_id);
create index if not exists crm_etapa_proj on public.crm_etapas(projeto_id);
create index if not exists crm_entrega_etapa on public.crm_entregas(etapa_id);
create index if not exists crm_anexo_entrega on public.crm_anexos(entrega_id);
create index if not exists crm_parcela_proj on public.crm_parcelas(projeto_id);

do $$ declare t text; begin
  foreach t in array array['crm_clientes','crm_oportunidades','crm_projetos','crm_etapas','crm_entregas','crm_anexos','crm_parcelas','crm_modelos','crm_google'] loop
    execute format('alter table public.%I enable row level security', t);
    if t <> 'crm_google' then
      execute format('drop policy if exists admin_tudo on public.%I', t);
      execute format('create policy admin_tudo on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    end if;
  end loop; end $$;

-- arquivos das entregas (privado)
insert into storage.buckets(id,name,public) values ('crm-anexos','crm-anexos',false) on conflict (id) do nothing;
drop policy if exists crm_anexos_admin on storage.objects;
create policy crm_anexos_admin on storage.objects for all to authenticated
  using (bucket_id = 'crm-anexos' and public.is_admin()) with check (bucket_id = 'crm-anexos' and public.is_admin());

-- criar projeto a partir de um modelo (estrutura: [{titulo, orientacao, entregas:[titulo,...]}])
create or replace function public.crm_projeto_de_modelo(p_cliente uuid, p_nome text, p_modelo uuid, p_oportunidade uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare pid uuid; eid uuid; e jsonb; i int := 0;
begin
  if not public.is_admin() then raise exception 'sem permissão'; end if;
  insert into public.crm_projetos(cliente_id,nome,oportunidade_id) values (p_cliente,p_nome,p_oportunidade) returning id into pid;
  for e in select * from jsonb_array_elements(coalesce((select estrutura from public.crm_modelos where id = p_modelo),'[]')) loop
    i := i + 1;
    insert into public.crm_etapas(projeto_id,ordem,titulo,orientacao) values (pid,i,e->>'titulo',e->>'orientacao') returning id into eid;
    insert into public.crm_entregas(etapa_id,ordem,titulo)
      select eid, row_number() over (), x from jsonb_array_elements_text(coalesce(e->'entregas','[]')) x;
  end loop;
  return pid;
end $$;
