-- Anexos do CRM (entregas e contratos) até 50 MB: o Storage grátis tem 1 GB, dividido com o rovya-stickers.
-- Arquivo maior vai para o Drive. A tela avisa antes (util.js LIMITE_ANEXO_MB); aqui o servidor recusa de qualquer jeito.
update storage.buckets set file_size_limit = 52428800 where id = 'crm-anexos';
