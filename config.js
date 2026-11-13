import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

// Projeto Supabase "rovya-stickers" (a chave publicável pode ficar no navegador; quem protege os dados é o RLS)
export const SUPABASE_URL = 'https://jgigosrsyxjqqhckudfe.supabase.co';
export const sb = createClient(SUPABASE_URL, 'sb_publishable_Y7tQfUBPShG6MIeAEChc5Q_3k2wOB0W');
