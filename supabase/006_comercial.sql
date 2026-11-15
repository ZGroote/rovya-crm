-- Etapa 1 do Manual Mestre: código de cliente, catálogo de serviços, propostas versionadas e contratos.

-- clientes: código sequencial R001 (dado quando vira cliente: contrato ou projeto), dados cadastrais
alter table public.crm_clientes
  add column if not exists codigo text unique,
  add column if not exists razao_social text,
  add column if not exists documento text;
create sequence if not exists public.crm_cliente_seq;

create or replace function public.crm_dar_codigo(p_cliente uuid) returns text
language plpgsql security invoker set search_path = '' as $$
declare cod text;
begin
  select codigo into cod from public.crm_clientes where id = p_cliente for update;
  if cod is null then
    cod := 'R' || lpad(nextval('public.crm_cliente_seq')::text, 3, '0');
    update public.crm_clientes set codigo = cod where id = p_cliente;
  end if;
  return cod;
end $$;

create or replace function public.crm_codigo_trg() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin perform public.crm_dar_codigo(new.cliente_id); return new; end $$;

-- leads: receptivo (chegou sozinho) ou ativo (prospecção)
alter table public.crm_oportunidades add column if not exists tipo_lead text not null default 'receptivo'
  check (tipo_lead in ('receptivo','ativo'));

-- catálogo de serviços
create table if not exists public.crm_servicos(
  id uuid primary key default gen_random_uuid(),
  codigo text unique, nome text not null, categoria text, descricao text, escopo text, entregaveis text,
  preco numeric(12,2), ativo boolean not null default true,
  criado_em timestamptz not null default now());

-- propostas: cada versão é uma linha; versões da mesma proposta dividem o "grupo"
create table if not exists public.crm_propostas(
  id uuid primary key default gen_random_uuid(),
  grupo uuid not null default gen_random_uuid(), versao int not null default 1,
  cliente_id uuid not null references public.crm_clientes on delete cascade,
  oportunidade_id uuid references public.crm_oportunidades on delete set null,
  titulo text not null, corpo text,
  itens jsonb not null default '[]', -- [{servico_id, nome, descricao, qtd, preco}]
  desconto numeric(12,2) not null default 0, valor numeric(12,2),
  validade date,
  status text not null default 'rascunho' check (status in ('rascunho','enviada','aprovada','recusada')),
  enviada_em date, criado_em timestamptz not null default now(),
  unique (grupo, versao));

-- contratos: recorrente (valor mensal), avulso (valor único) ou misto (os dois)
create table if not exists public.crm_contratos(
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.crm_clientes on delete cascade,
  proposta_id uuid references public.crm_propostas on delete set null,
  projeto_id uuid references public.crm_projetos on delete set null,
  titulo text not null,
  tipo text not null check (tipo in ('recorrente','avulso','misto')),
  inicio date, fim date,
  valor_mensal numeric(12,2), valor_avulso numeric(12,2),
  renovacao_auto boolean not null default false, aviso_dias int not null default 30,
  status text not null default 'rascunho' check (status in ('rascunho','assinatura','vigente','encerrado','cancelado')),
  link_assinado text, arquivo text, -- arquivo = caminho no bucket crm-anexos
  notas text, criado_em timestamptz not null default now());

drop trigger if exists crm_contrato_codigo on public.crm_contratos;
create trigger crm_contrato_codigo after insert on public.crm_contratos for each row execute function public.crm_codigo_trg();
drop trigger if exists crm_projeto_codigo on public.crm_projetos;
create trigger crm_projeto_codigo after insert on public.crm_projetos for each row execute function public.crm_codigo_trg();

alter table public.crm_modelos drop constraint if exists crm_modelos_tipo_check;
alter table public.crm_modelos add constraint crm_modelos_tipo_check
  check (tipo in ('projeto','orientacao','proposta','contrato','termo','email','whatsapp','outro'));

create index if not exists crm_prop_cliente on public.crm_propostas(cliente_id);
create index if not exists crm_prop_grupo on public.crm_propostas(grupo);
create index if not exists crm_contr_cliente on public.crm_contratos(cliente_id);

do $$ declare t text; begin
  foreach t in array array['crm_servicos','crm_propostas','crm_contratos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists admin_tudo on public.%I', t);
    execute format('create policy admin_tudo on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop; end $$;

-- quem já tem projeto vira cliente com código, na ordem de chegada
grant usage on sequence public.crm_cliente_seq to authenticated;
do $$ declare r record; begin
  for r in select c.id from public.crm_clientes c
    where c.codigo is null and exists (select 1 from public.crm_projetos p where p.cliente_id = c.id) order by c.criado_em
  loop perform public.crm_dar_codigo(r.id); end loop; end $$;
