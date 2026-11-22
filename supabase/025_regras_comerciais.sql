-- Regras comerciais (A2 do Mapa do CRM, 22/11/2026): a decisão sobre a proposta e o funil andam juntos, numa transação.
--   Aprovar à mão  → proposta aprovada + oportunidade Fechado (como no aceite pelo link). Contrato e projeto NÃO são criados:
--                    o Início mostra "falta o contrato".
--   Recusar à mão  → proposta recusada + oportunidade Perdido, com o motivo (obrigatório) no cartão do funil.
--   Oportunidade já encerrada de outro jeito (aprovar com o cartão em Perdido, recusar com o cartão em Fechado):
--                    recusa a operação inteira com uma mensagem clara; nada é sobrescrito.
--   Reabrir        → aprovada sem aceite online volta a enviada; recusada volta a enviada. SÓ a proposta muda: reabrir uma
--                    proposta NÃO reabre a oportunidade encerrada (decisão comercial de 22/11/2026, PR #2); a Sabrina revisa o
--                    cartão no Funil. O histórico registra a reabertura; contrato e histórico ficam.
--   Aceite online com o cartão em Perdido: o aceite do cliente vale, o cartão não é sobrescrito e o histórico/aviso dizem isso.
-- O status da proposta passa a mudar só por crm_proposta_decidir ou pelo aceite online (o gatilho recusa mudança direta).
-- Só acrescenta/troca funções: nenhuma linha muda.

/* ---------- gatilho da proposta: mesma regra de passagens + só pelo caminho oficial ---------- */
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
    if new.status is distinct from old.status then
      if not ((old.status = 'rascunho' and new.status = 'enviada')
           or (old.status = 'enviada' and new.status in ('aprovada', 'recusada'))
           or (old.status = 'recusada' and new.status = 'enviada')
           or (old.status = 'aprovada' and new.status = 'enviada' and old.aceite_em is null)) then
        raise exception 'Proposta %: não pode virar % direto (caminho: rascunho → enviada → aprovada ou recusada).', rot->>old.status, rot->>new.status
          using errcode = 'check_violation';
      end if;
      if coalesce(current_setting('crm.proposta_status', true), '') <> '1' then
        raise exception 'Mude o status da proposta pelos botões da proposta (assim o funil acompanha).' using errcode = 'check_violation';
      end if;
    end if;
  end if;
  if new.status = 'enviada' and new.token is null then new.token := replace(gen_random_uuid()::text, '-', ''); end if;
  return new;
end $$;

/* ---------- decidir a proposta (CRM) ---------- */
create or replace function public.crm_proposta_decidir(p_proposta uuid, p_status text, p_motivo text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare p record; v_etapa text; alvo text; mot text := nullif(left(trim(coalesce(p_motivo, '')), 500), '');
  rot jsonb := '{"ganho":"Fechado","perdido":"Perdido"}'; funil boolean := false;
begin
  if not public.is_admin() then raise exception 'sem permissão'; end if;
  if p_status is null or p_status not in ('enviada', 'aprovada', 'recusada') then raise exception 'Status inválido: %', p_status using errcode = 'check_violation'; end if;
  select * into p from public.crm_propostas where id = p_proposta for update;
  if not found then raise exception 'Proposta não encontrada.' using errcode = 'no_data_found'; end if;
  if p.status = p_status then return jsonb_build_object('ok', true, 'ja', true, 'funil_alterado', false); end if; -- repetição: nada muda
  if p_status = 'recusada' and (mot is null or length(mot) < 3) then raise exception 'Conte o motivo da recusa.' using errcode = 'check_violation'; end if;
  if p.oportunidade_id is not null and p_status in ('aprovada', 'recusada') then
    select etapa into v_etapa from public.crm_oportunidades where id = p.oportunidade_id for update;
    alvo := case p_status when 'aprovada' then 'ganho' else 'perdido' end;
    if v_etapa in ('ganho', 'perdido') and v_etapa <> alvo then
      raise exception 'A oportunidade desta proposta já está encerrada como %. Reabra o cartão no Funil antes de % a proposta.',
        rot->>v_etapa, case p_status when 'aprovada' then 'aprovar' else 'recusar' end using errcode = 'check_violation';
    end if;
  end if;
  perform set_config('crm.proposta_status', '1', true);
  update public.crm_propostas set status = p_status,
    enviada_em = case when p_status = 'enviada' then coalesce(enviada_em, (now() at time zone 'America/Sao_Paulo')::date) else enviada_em end
    where id = p.id;
  perform set_config('crm.proposta_status', '', true);
  if alvo is not null and v_etapa is distinct from alvo then
    update public.crm_oportunidades set etapa = alvo, motivo_perda = case when alvo = 'perdido' then mot else motivo_perda end,
      fechado_em = now(), atualizado_em = now() where id = p.oportunidade_id;
    funil := true;
  end if;
  if p.status <> 'rascunho' or p_status <> 'enviada' then -- enviar o rascunho não precisa de registro; o resto fica no histórico
    insert into public.crm_interacoes(cliente_id, oportunidade_id, tipo, resumo) values (p.cliente_id, p.oportunidade_id, 'nota',
      case p_status
        when 'aprovada' then format('Proposta “%s” (v%s) aprovada.%s', p.titulo, p.versao, case when funil then ' Funil: Fechado.' else '' end)
        when 'recusada' then format('Proposta “%s” (v%s) recusada. Motivo: %s%s', p.titulo, p.versao, mot, case when funil then ' Funil: Perdido.' else '' end)
        else format('Proposta “%s” (v%s) reaberta (estava %s). O funil não foi alterado.', p.titulo, p.versao, p.status) end);
  end if;
  return jsonb_build_object('ok', true, 'funil_alterado', funil, 'oportunidade', case when funil then alvo else v_etapa end);
end $$;
revoke all on function public.crm_proposta_decidir(uuid, text, text) from public, anon;
grant execute on function public.crm_proposta_decidir(uuid, text, text) to authenticated;

/* ---------- aceite online: não sobrescreve cartão em Perdido ---------- */
create or replace function public.crm_proposta_aceitar(p_token text, p_nome text, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p record; v_nome text := left(trim(coalesce(p_nome, '')), 120); emp text; v_etapa text; conflito boolean := false;
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
  perform set_config('crm.proposta_status', '1', true);
  update public.crm_propostas set status = 'aprovada', aceite_em = now(), aceite_nome = v_nome, aceite_ip = left(p_ip, 64) where id = p.id;
  perform set_config('crm.proposta_status', '', true);
  if p.oportunidade_id is not null then
    select etapa into v_etapa from public.crm_oportunidades where id = p.oportunidade_id for update;
    if v_etapa = 'perdido' then conflito := true;
    elsif v_etapa <> 'ganho' then
      update public.crm_oportunidades set etapa = 'ganho', fechado_em = now(), atualizado_em = now() where id = p.oportunidade_id;
    end if;
  end if;
  insert into public.crm_interacoes(cliente_id, oportunidade_id, tipo, resumo)
    values (p.cliente_id, p.oportunidade_id, 'mensagem', format('Proposta “%s” (v%s) aceita online por %s.%s', p.titulo, p.versao, v_nome,
      case when conflito then ' A oportunidade estava como Perdido e não foi alterada: revise o Funil.' else '' end));
  select coalesce(empresa, nome) into emp from public.crm_clientes where id = p.cliente_id;
  return jsonb_build_object('ok', true, 'id', p.id, 'titulo', p.titulo, 'empresa', emp, 'aceite_nome', v_nome, 'aceite_em', now(), 'conflito', conflito);
end $$;
revoke all on function public.crm_proposta_aceitar(text, text, text) from public, anon, authenticated;
grant execute on function public.crm_proposta_aceitar(text, text, text) to service_role;
