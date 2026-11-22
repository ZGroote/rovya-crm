-- A1 do Mapa do CRM (22/11/2026): avisar o cliente quando há peça para aprovar, com o WhatsApp assistido.
-- O banco cuida das datas, da atomicidade e de não duplicar:
--   enviado_em : quando a peça entrou em "Enviado" NESTA rodada (aguardando aprovação desde). Muda só quando a peça
--                sai de Enviado e volta (rodada nova). Editar texto/link/prazo de uma peça em Enviado não mexe nela.
--   aviso_em   : o PRIMEIRO aviso confirmado desta rodada. Avisos seguintes (reenvio) ficam no histórico, mas não mudam a data,
--                para um reenvio não esconder uma aprovação atrasada. Só muda pela função crm_aviso_confirmar.
--   enviado_aprox: true nas peças que já estavam em Enviado antes desta migração: enviado_em veio de atualizado_em,
--                é uma APROXIMAÇÃO histórica e não prova a data do envio original.
-- O lembrete de 3 dias conta a partir de aviso_em (se houver) ou de enviado_em.

alter table public.crm_entregas
  add column if not exists enviado_em timestamptz,
  add column if not exists aviso_em timestamptz,
  add column if not exists enviado_aprox boolean not null default false;

-- código de cada aviso preparado: confirmar duas vezes (clique duplo, tela recarregada) não duplica o histórico
alter table public.crm_interacoes add column if not exists operacao uuid;
create unique index if not exists crm_interacoes_operacao on public.crm_interacoes(operacao) where operacao is not null;

-- peças que já estão em Enviado: aproximação histórica (marcada como tal). Antes do gatilho novo, que protege estas datas
update public.crm_entregas set enviado_em = coalesce(atualizado_em, now()), enviado_aprox = true
  where status = 'enviado' and enviado_em is null;

-- gatilho da peça: revisões e aprovação como antes + datas da rodada
create or replace function public.crm_entrega_trg() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.enviado_em := case when new.status = 'enviado' then now() end;
    new.aviso_em := null; new.enviado_aprox := false;
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'revisao' then new.revisoes := old.revisoes + 1; end if;
    new.aprovado_em := case when new.status = 'aprovado' then now() end;
    if new.status = 'enviado' then -- rodada nova
      new.enviado_em := now(); new.aviso_em := null; new.enviado_aprox := false;
    else
      new.enviado_em := old.enviado_em; new.aviso_em := old.aviso_em; new.enviado_aprox := old.enviado_aprox;
    end if;
  else -- edição sem mudar o status: as datas da rodada não mudam
    new.enviado_em := old.enviado_em; new.enviado_aprox := old.enviado_aprox;
    if coalesce(current_setting('crm.aviso', true), '') <> '1' then new.aviso_em := old.aviso_em; end if;
  end if;
  return new;
end $$;
drop trigger if exists crm_entrega on public.crm_entregas;
create trigger crm_entrega before insert or update on public.crm_entregas for each row execute function public.crm_entrega_trg();

-- confirmar o aviso (WhatsApp: depois do "Mandou?"; e-mail: depois que o Gmail confirmou o envio)
-- p_itens: [{id, rodada}] com o enviado_em que a mensagem viu. Peça que mudou de rodada (saiu de Enviado, voltou, foi
-- reenviada) ou é de outro cliente não entra; se nenhuma vale, nada é registrado.
create or replace function public.crm_aviso_confirmar(p_operacao uuid, p_cliente uuid, p_canal text, p_itens jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_ids uuid[]; v_titulos text; n int; total int := jsonb_array_length(coalesce(p_itens, '[]'));
begin
  if not public.is_admin() then raise exception 'sem permissão'; end if;
  if p_operacao is null or p_cliente is null then raise exception 'Aviso sem código ou sem cliente.' using errcode = 'check_violation'; end if;
  if p_canal is null or p_canal not in ('whatsapp', 'email') then raise exception 'Canal inválido: %', p_canal using errcode = 'check_violation'; end if;
  perform pg_advisory_xact_lock(hashtext('crm_aviso:' || p_operacao::text));
  if exists (select 1 from public.crm_interacoes where operacao = p_operacao) then
    return jsonb_build_object('ok', true, 'ja', true, 'registradas', 0);
  end if;
  perform 1 from public.crm_entregas where id in (select (x->>'id')::uuid from jsonb_array_elements(p_itens) x) for update;
  select array_agg(e.id order by e.ordem), string_agg(e.titulo, ', ' order by e.ordem) into v_ids, v_titulos
    from public.crm_entregas e
    join public.crm_etapas et on et.id = e.etapa_id
    join public.crm_projetos pr on pr.id = et.projeto_id
    join (select (x->>'id')::uuid id, (x->>'rodada')::timestamptz rodada from jsonb_array_elements(p_itens) x) i on i.id = e.id
    where e.status = 'enviado' and e.enviado_em = i.rodada and pr.cliente_id = p_cliente and not et.consulta;
  n := coalesce(array_length(v_ids, 1), 0);
  if n = 0 then
    raise exception 'Estas peças mudaram desde que a mensagem foi preparada (saíram de Enviado ou foram reenviadas). Prepare o aviso de novo.'
      using errcode = 'check_violation';
  end if;
  perform set_config('crm.aviso', '1', true);
  update public.crm_entregas set aviso_em = now() where id = any(v_ids) and aviso_em is null; -- só o primeiro aviso da rodada
  perform set_config('crm.aviso', '', true);
  insert into public.crm_interacoes(cliente_id, tipo, resumo, operacao)
    values (p_cliente, case p_canal when 'email' then 'email' else 'mensagem' end,
      format('Aviso de aprovação enviado por %s: %s %s (%s).', case p_canal when 'email' then 'e-mail' else 'WhatsApp' end,
        n, case when n = 1 then 'peça' else 'peças' end, left(v_titulos, 1500)), p_operacao);
  return jsonb_build_object('ok', true, 'registradas', n, 'ignoradas', total - n);
end $$;
revoke all on function public.crm_aviso_confirmar(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.crm_aviso_confirmar(uuid, uuid, text, jsonb) to authenticated;
