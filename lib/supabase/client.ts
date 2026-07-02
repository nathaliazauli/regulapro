"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente Supabase oficial para uso no navegador (Client Components).
 *
 * Usa exclusivamente as variáveis públicas NEXT_PUBLIC_SUPABASE_URL e
 * NEXT_PUBLIC_SUPABASE_ANON_KEY. Nenhuma outra credencial é necessária —
 * toda a proteção de dados fica a cargo das políticas de RLS (ver
 * supabase/migrations/0001_init.sql).
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Variáveis NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY não " +
        "configuradas. Copie .env.local.example para .env.local e preencha com " +
        "as credenciais do seu projeto Supabase."
    );
  }

  return createBrowserClient(url, anonKey);
}

/**
 * Cliente Supabase "isolado", com persistência de sessão desativada.
 *
 * Usado apenas para a ação administrativa de convidar/criar um novo usuário
 * (supabase.auth.signUp) sem substituir a sessão do administrador que está
 * logado no cliente principal. Não requer service_role — usa a mesma anon key.
 */
export function createIsolatedClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Variáveis NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY não configuradas."
    );
  }

  return createBrowserClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
