"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { createClient, createIsolatedClient } from "@/lib/supabase/client";

// Expõe o cliente Supabase oficial no escopo global ANTES do legado
// (public/legacy/app.js) ser carregado, para que toda a lógica de negócio
// existente (produtos, reuniões, matéria-prima, usuários, etc.) possa
// consumi-lo diretamente como `supabase` / `window.supabase`.
//
// Isto roda dentro de um useEffect (client-side, após o primeiro render) e
// só libera o carregamento de /legacy/app.js depois que o cliente Supabase
// foi criado com sucesso — evitando a condição de corrida sem deixar um
// erro de configuração derrubar a aplicação inteira (Next.js mostraria a
// tela genérica "Application error: a client-side exception has occurred").
export default function AppBootstrap() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if ((window as any).supabase) {
      setStatus("ready");
      return;
    }
    try {
      (window as any).supabase = createClient();
      // Cliente sem persistência de sessão, usado apenas para criar novos
      // usuários (Usuários → convidar) sem substituir a sessão do admin logado.
      (window as any).supabaseIsolatedFactory = createIsolatedClient;
      setStatus("ready");
    } catch (e: any) {
      console.error("Erro ao inicializar o cliente Supabase:", e);
      setErrorMsg(e?.message || "Erro desconhecido ao inicializar o Supabase.");
      setStatus("error");
    }
  }, []);

  if (status === "error") {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 99999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8fafc",
          fontFamily:
            "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 560,
            padding: "28px 32px",
            borderRadius: 14,
            border: "1.5px solid #fecaca",
            background: "#fff5f5",
            color: "#991b1b",
            lineHeight: 1.6,
            boxShadow: "0 8px 32px rgba(0,0,0,.06)",
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
            ⚠️ Configuração do Supabase pendente
          </div>
          <div style={{ fontSize: 13.5, marginBottom: 12 }}>{errorMsg}</div>
          <div style={{ fontSize: 13, color: "#7f1d1d" }}>
            Verifique se <code>NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> estão definidas:
            <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
              <li>
                Rodando local: copie <code>.env.local.example</code> para{" "}
                <code>.env.local</code>, preencha os dois valores e reinicie{" "}
                <code>npm run dev</code>.
              </li>
              <li>
                Na Vercel: Project Settings → Environment Variables → adicione as
                duas variáveis e faça um novo deploy.
              </li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  if (status !== "ready") return null;

  return <Script src="/legacy/app.js" strategy="afterInteractive" />;
}
