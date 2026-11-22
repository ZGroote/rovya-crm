-- Fluxo: escopo do contrato, mês de conteúdo ligado ao contrato, aceite online da proposta,
-- status de proposta/contrato conferidos no banco e ações do portal numa gravação só (auditoria de 22/11/2026).
-- Só acrescenta: nenhuma linha existente muda.

/* ---------- 1) escopo do contrato ---------- */
alter table public.crm_contratos
  add column if not exists posts_mes int check (posts_mes > 0),            -- posts por mês incluídos
  add column if not exists ajustes_inclusos int check (ajustes_inclusos >= 0); -- rodadas de ajuste por peça incluídas

-- projeto do mês: ligado ao contrato, um por mês (o índice impede criar o mesmo mês duas vezes)
alter table public.crm_projetos
  add column if not exists contrato_id uuid references public.crm_contratos on delete set null,
  add column if not exists mes text check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$');
create unique index if not exists crm_proj_contrato_mes on public.crm_projetos(contrato_id, mes) where contrato_id is not null and mes is not null;
create index if not exists crm_proj_contrato on public.crm_projetos(contrato_id);

/* ---------- 2) status: só as passagens que fazem sentido ---------- */
-- proposta: rascunho → enviada → aprovada | recusada; recusada pode reabrir; aprovada sem aceite online pode voltar a enviada (clique errado).
-- Versão nova nasce sem link e sem aceite. O aceite online (nome, data, IP) não se apaga.
alter table public.crm_propostas
  add column if not exists token text unique,      -- link para o cliente ver e aceitar (gerado ao enviar)
  add column if not exists aceite_em timestamptz,
  add column if not exists aceite_nome text,
  add column if not exists aceite_ip text,
  add column if not exists renova_contrato uuid references public.crm_contratos on delete set null; -- proposta de renovação: qual contrato ela renova

create or replace function public.crm_proposta_trg() returns trigger
language plpgsql set search_path = '' as $$
declare rot jsonb := '{"rascunho":"rascunho","enviada":"enviada","aprovada":"aprovada","recusada":"recusada"}';
begin
  if tg_op = 'INSERT' then
    new.token := null; new.aceite_em := null; new.aceite_nome := null; new.aceite_ip := null;
  else
    if old.aceite_em is not null then
      new.aceite_em := old.aceite_em; new.aceite_nome := old.aceite_nome; new.aceite_ip := old.aceite_ip; new.token := old.token;
    end if;
    if new.status is distinct from old.status and not (
         (old.status = 'rascunho' and new.status = 'enviada')
      or (old.status = 'enviada' and new.status in ('aprovada', 'recusada'))
      or (old.status = 'recusada' and new.status = 'enviada')
      or (old.status = 'aprovada' and new.status = 'enviada' and old.aceite_em is null)) then
      raise exception 'Proposta %: não pode virar % direto (caminho: rascunho → enviada → aprovada ou recusada).', rot->>old.status, rot->>new.status
        using errcode = 'check_violation';
    end if;
  end if;
  if new.status = 'enviada' and new.token is null then new.token := replace(gen_random_uuid()::text, '-', ''); end if;
  return new;
end $$;
drop trigger if exists crm_proposta on public.crm_propostas;
create trigger crm_proposta before insert or update on public.crm_propostas for each row execute function public.crm_proposta_trg();

-- contrato: rascunho ⇄ aguardando assinatura → vigente → encerrado | cancelado; encerrado pode voltar a vigente (renovou); cancelado é final.
create or replace function public.crm_contrato_trg() returns trigger
language plpgsql set search_path = '' as $$
declare rot jsonb := '{"rascunho":"rascunho","assinatura":"aguardando assinatura","vigente":"vigente","encerrado":"encerrado","cancelado":"cancelado"}';
begin
  if new.status is distinct from old.status and not (
       (old.status = 'rascunho' and new.status in ('assinatura', 'vigente', 'cancelado'))
    or (old.status = 'assinatura' and new.status in ('rascunho', 'vigente', 'cancelado'))
    or (old.status = 'vigente' and new.status in ('encerrado', 'cancelado'))
    or (old.status = 'encerrado' and new.status = 'vigente')) then
    raise exception 'Contrato %: não pode virar %.', rot->>old.status, rot->>new.status using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists crm_contrato on public.crm_contratos;
create trigger crm_contrato before update on public.crm_contratos for each row execute function public.crm_contrato_trg();

/* ---------- 3) criar projeto numa gravação só (valor, entrega, contrato e mês juntos) ---------- */
drop function if exists public.crm_projeto_de_modelo(uuid, text, uuid, uuid, jsonb);
create or replace function public.crm_projeto_de_modelo(p_cliente uuid, p_nome text, p_modelo uuid, p_oportunidade uuid default null, p_estrutura jsonb default null,
  p_contrato uuid default null, p_mes text default null, p_valor numeric default null, p_entrega date default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare pid uuid; eid uuid; e jsonb; x jsonb; i int := 0; j int; emp text; cont text; st text;
begin
  if not public.is_admin() then raise exception 'sem permissão'; end if;
  if p_mes is not null and exists (select 1 from public.crm_projetos where contrato_id = p_contrato and mes = p_mes) then
    raise exception 'Este contrato já tem o projeto de %.', p_mes using errcode = 'unique_violation';
  end if;
  select coalesce(empresa, nome), split_part(nome, ' ', 1) into emp, cont from public.crm_clientes where id = p_cliente;
  insert into public.crm_projetos(cliente_id, nome, oportunidade_id, contrato_id, mes, valor, entrega_prevista)
    values (p_cliente, p_nome, p_oportunidade, p_contrato, p_mes, p_valor, p_entrega) returning id into pid;
  -- contrato de um projeto só (avulso): fica ligado nos dois sentidos. Contrato mensal liga pelos meses (crm_projetos.contrato_id).
  if p_contrato is not null and p_mes is null then
    update public.crm_contratos set projeto_id = pid where id = p_contrato and projeto_id is null;
  end if;
  for e in select * from jsonb_array_elements(coalesce(p_estrutura, (select estrutura from public.crm_modelos where id = p_modelo), '[]')) loop
    i := i + 1; j := 0;
    insert into public.crm_etapas(projeto_id, ordem, titulo, orientacao, consulta)
      values (pid, i, e->>'titulo', e->>'orientacao', coalesce((e->>'consulta')::boolean, false)) returning id into eid;
    for x in select * from jsonb_array_elements(coalesce(e->'entregas', '[]')) loop
      j := j + 1;
      if jsonb_typeof(x) = 'string' then x := jsonb_build_object('titulo', x #>> '{}'); end if;
      st := coalesce(x->>'status', 'a_fazer');
      insert into public.crm_entregas(etapa_id, ordem, titulo, texto, formato, prazo, status, aprovado_em)
        values (eid, j, x->>'titulo',
          replace(replace(x->>'texto', '{{empresa}}', coalesce(emp, '{{empresa}}')), '{{contato}}', coalesce(cont, '{{contato}}')),
          x->>'formato', (x->>'prazo')::date, st, case when st = 'aprovado' then now() end);
    end loop;
  end loop;
  return pid;
end $$;

/* ---------- 4) portal: aprovar / pedir alteração / nova solicitação numa transação ---------- */
-- Chamadas só pela função crm-portal (service role), que já conferiu de qual cliente é o login.
create or replace function public.crm_portal_entrega(p_cliente uuid, p_entrega uuid, p_acao text, p_comentario text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x record; com text := left(trim(coalesce(p_comentario, '')), 2000); rev int; incl int; resto int;
begin
  select en.id, en.titulo, en.status, et.id etapa_id, et.titulo etapa, et.consulta, pr.id projeto_id, pr.nome projeto, pr.status pst, pr.cliente_id, pr.contrato_id
    into x from public.crm_entregas en join public.crm_etapas et on et.id = en.etapa_id join public.crm_projetos pr on pr.id = et.projeto_id
    where en.id = p_entrega for update of en;
  if not found or x.cliente_id is distinct from p_cliente or x.pst = 'arquivado' then return jsonb_build_object('erro', 'Entrega não encontrada.', 'codigo', 404); end if;
  if x.consulta then return jsonb_build_object('erro', 'Este cartão é só para consulta.', 'codigo', 409); end if;
  if x.status <> 'enviado' then return jsonb_build_object('erro', 'Esta entrega não está aguardando a sua aprovação.', 'codigo', 409); end if;
  if p_acao = 'aprovar' then
    update public.crm_entregas set status = 'aprovado', atualizado_em = now() where id = x.id;
    insert into public.crm_interacoes(cliente_id, tipo, resumo) values (p_cliente, 'mensagem', format('Pelo portal: aprovou “%s” (%s).', x.titulo, x.projeto));
    select count(*) into resto from public.crm_entregas where etapa_id = x.etapa_id and status <> 'aprovado';
    return jsonb_build_object('ok', true, 'titulo', x.titulo, 'projeto_id', x.projeto_id, 'etapa', x.etapa, 'etapa_completa', resto = 0);
  elsif p_acao = 'alterar' then
    if length(com) < 3 then return jsonb_build_object('erro', 'Conte o que você quer mudar.', 'codigo', 400); end if;
    update public.crm_entregas set status = 'revisao', atualizado_em = now() where id = x.id returning revisoes into rev;
    insert into public.crm_tarefas(cliente_id, projeto_id, titulo, descricao, prioridade, origem)
      values (p_cliente, x.projeto_id, left('Ajuste pedido pelo cliente: ' || x.titulo, 200), com, 'alta', 'portal');
    insert into public.crm_interacoes(cliente_id, tipo, resumo) values (p_cliente, 'mensagem', format(E'Pelo portal: pediu alteração em “%s” (%s).\n\n%s', x.titulo, x.projeto, com));
    select ajustes_inclusos into incl from public.crm_contratos where id = x.contrato_id;
    return jsonb_build_object('ok', true, 'titulo', x.titulo, 'projeto_id', x.projeto_id, 'revisoes', rev, 'inclusos', incl);
  end if;
  return jsonb_build_object('erro', 'Ação desconhecida.', 'codigo', 400);
end $$;

create or replace function public.crm_portal_pedido(p_cliente uuid, p_titulo text, p_descricao text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t text := left(trim(coalesce(p_titulo, '')), 150); d text := nullif(left(trim(coalesce(p_descricao, '')), 3000), '');
begin
  if length(t) < 3 then return jsonb_build_object('erro', 'Dê um título para o pedido.', 'codigo', 400); end if;
  perform pg_advisory_xact_lock(hashtext('crm_portal_pedido' || p_cliente::text)); -- dois envios juntos não furam o limite
  if (select count(*) from public.crm_tarefas where cliente_id = p_cliente and origem = 'portal' and titulo like 'Pedido do cliente:%' and criado_em > now() - interval '1 day') >= 10 then
    return jsonb_build_object('erro', 'Muitos pedidos hoje. Fale com a Rovya pelo WhatsApp.', 'codigo', 429);
  end if;
  insert into public.crm_tarefas(cliente_id, titulo, descricao, prioridade, origem) values (p_cliente, 'Pedido do cliente: ' || t, d, 'media', 'portal');
  insert into public.crm_interacoes(cliente_id, tipo, resumo) values (p_cliente, 'mensagem', 'Pelo portal: nova solicitação “' || t || '”.' || coalesce(E'\n\n' || d, ''));
  return jsonb_build_object('ok', true, 'titulo', t);
end $$;

/* ---------- 5) proposta aceita online (rovyacreative.com.br/proposta#<link>) ---------- */
-- Chamadas só pela função crm-proposta (service role). O link vale para a última versão, enviada e dentro da validade.
create or replace function public.crm_proposta_publica(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('titulo', p.titulo, 'versao', p.versao, 'corpo', p.corpo, 'itens', p.itens, 'desconto', p.desconto, 'valor', p.valor,
    'validade', p.validade, 'status', p.status, 'enviada_em', p.enviada_em, 'aceite_em', p.aceite_em, 'aceite_nome', p.aceite_nome,
    'vencida', p.validade < (now() at time zone 'America/Sao_Paulo')::date,
    'atualizada', exists (select 1 from public.crm_propostas n where n.grupo = p.grupo and n.versao > p.versao),
    'cliente', jsonb_build_object('nome', c.nome, 'empresa', c.empresa))
  from public.crm_propostas p join public.crm_clientes c on c.id = p.cliente_id
  where p.token = p_token and p_token ~ '^[0-9a-f]{32}$';
$$;

create or replace function public.crm_proposta_aceitar(p_token text, p_nome text, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p record; v_nome text := left(trim(coalesce(p_nome, '')), 120); emp text;
begin
  if p_token !~ '^[0-9a-f]{32}$' then return jsonb_build_object('erro', 'Link inválido.', 'codigo', 404); end if;
  select * into p from public.crm_propostas where token = p_token for update;
  if not found then return jsonb_build_object('erro', 'Link inválido.', 'codigo', 404); end if;
  if p.status = 'aprovada' and p.aceite_em is not null then return jsonb_build_object('ok', true, 'ja', true, 'aceite_em', p.aceite_em, 'aceite_nome', p.aceite_nome); end if;
  if exists (select 1 from public.crm_propostas n where n.grupo = p.grupo and n.versao > p.versao) then
    return jsonb_build_object('erro', 'Esta proposta tem uma versão mais nova. Peça o link atualizado à Rovya.', 'codigo', 409); end if;
  if p.status <> 'enviada' then return jsonb_build_object('erro', 'Esta proposta não está aberta para aceite. Fale com a Rovya.', 'codigo', 409); end if;
  if p.validade < (now() at time zone 'America/Sao_Paulo')::date then
    return jsonb_build_object('erro', 'O prazo desta proposta venceu. Fale com a Rovya para renovar.', 'codigo', 409); end if;
  if length(v_nome) < 3 then return jsonb_build_object('erro', 'Escreva seu nome completo.', 'codigo', 400); end if;
  update public.crm_propostas set status = 'aprovada', aceite_em = now(), aceite_nome = v_nome, aceite_ip = left(p_ip, 64) where id = p.id;
  if p.oportunidade_id is not null then
    update public.crm_oportunidades set etapa = 'ganho', fechado_em = now(), atualizado_em = now() where id = p.oportunidade_id and etapa <> 'ganho';
  end if;
  insert into public.crm_interacoes(cliente_id, oportunidade_id, tipo, resumo)
    values (p.cliente_id, p.oportunidade_id, 'mensagem', format('Proposta “%s” (v%s) aceita online por %s.', p.titulo, p.versao, v_nome));
  select coalesce(empresa, nome) into emp from public.crm_clientes where id = p.cliente_id;
  return jsonb_build_object('ok', true, 'id', p.id, 'titulo', p.titulo, 'empresa', emp, 'aceite_nome', v_nome, 'aceite_em', now());
end $$;

revoke all on function public.crm_portal_entrega(uuid, uuid, text, text), public.crm_portal_pedido(uuid, text, text),
  public.crm_proposta_publica(text), public.crm_proposta_aceitar(text, text, text) from public, anon, authenticated;
grant execute on function public.crm_portal_entrega(uuid, uuid, text, text), public.crm_portal_pedido(uuid, text, text),
  public.crm_proposta_publica(text), public.crm_proposta_aceitar(text, text, text) to service_role;
