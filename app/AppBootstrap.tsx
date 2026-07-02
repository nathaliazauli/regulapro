"use client";

import Script from "next/script";
import { createClient, createIsolatedClient } from "@/lib/supabase/client";

// Expõe o cliente Supabase oficial no escopo global ANTES do legado
// (public/legacy/app.js) ser carregado, para que toda a lógica de negócio
// existente (produtos, reuniões, matéria-prima, usuários, etc.) possa
// consumi-lo diretamente como `supabase` / `window.supabase`.
//
// Isto roda durante a avaliação do módulo no navegador — ou seja, antes do
// <Script strategy="afterInteractive"> injetar o app.js — garantindo a ordem
// correta sem condição de corrida.
if (typeof window !== "undefined" && !(window as any).supabase) {
  (window as any).supabase = createClient();
  // Cliente sem persistência de sessão, usado apenas para criar novos
  // usuários (Usuários → convidar) sem substituir a sessão do admin logado.
  (window as any).supabaseIsolatedFactory = createIsolatedClient;
}

export default function AppBootstrap() {
  return (
    <Script
      src="/legacy/app.js"
      strategy="afterInteractive"
    />
  );
}
