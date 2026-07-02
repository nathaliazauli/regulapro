# RegulaPro — Painel de Assuntos Regulatórios

Aplicativo interno de gestão regulatória (ANVISA · Cosméticos): Painel de Produtos,
Painel de Demandas, Biodiversidade/Matéria-prima, Painel de Reuniões, BI/Levantamentos,
Usuários, SLA e Feriados.

Este projeto foi convertido para **Next.js 14 (App Router) + Supabase**: autenticação,
banco de dados e armazenamento de arquivos usam o cliente oficial do Supabase
(`@supabase/supabase-js` via `@supabase/ssr`). O layout, a lógica de negócio e a
experiência do usuário do app original foram preservados integralmente.

---

## 0. Dois formatos neste pacote

Este .zip contém **duas formas de usar o mesmo projeto**:

1. **Projeto Next.js completo** (pasta raiz — `app/`, `lib/`, `middleware.ts`, etc.)
   → para rodar com `npm run dev` / publicar no GitHub e fazer deploy na Vercel.
   Siga as instruções normalmente a partir da seção 2 abaixo.

2. **`regulapro_standalone.html`** → o mesmo app inteiro (mesma lógica, mesmo
   Supabase) num único arquivo HTML, sem precisar de Node/build/Vercel. Basta
   abrir o arquivo num editor de texto, preencher `SUPABASE_URL` e
   `SUPABASE_ANON_KEY` perto do final do arquivo e abrir no navegador (ou
   hospedar como um HTML estático em qualquer lugar). Útil se você só quer
   usar o painel rapidamente sem montar o projeto Next.js. Em ambos os casos
   é preciso rodar a migração `supabase/migrations/0001_init.sql` uma vez no
   seu projeto Supabase antes de usar (ver seção 3).

## 1. Arquitetura

- **Frontend**: o `app/page.tsx` (Server Component) renderiza o HTML original do
  painel (login + shell do app + todas as páginas/modais), preservado em
  `app/_markup/dashboard.html`. Toda a lógica de negócio (renderização, filtros,
  checklist, SLA, etc. — ~3700 linhas) vive em `public/legacy/app.js` e é carregada
  como um `<script>` clássico pelo componente `app/AppBootstrap.tsx`.
- **Supabase**: `app/AppBootstrap.tsx` cria o cliente oficial do Supabase
  (`lib/supabase/client.ts`) e o expõe em `window.supabase` **antes** de
  `public/legacy/app.js` ser carregado — por isso o script legado consegue usar
  `supabase.from(...)`, `supabase.auth...` e `supabase.storage...` normalmente,
  sem duplicar configuração.
- **Por que não reescrever tudo em componentes React?** O app original é uma SPA
  vanilla-JS madura, com dezenas de funcionalidades interligadas (checklist por
  etapa, retrocessos, kits, SLA com recálculo automático, BI, etc.). Preservar o
  script original e trocar apenas a camada de persistência (localStorage →
  Supabase) garante fidelidade de 100% ao layout/lógica/UX pedidos, com risco
  muito menor do que reescrever manualmente milhares de linhas em JSX.
- **Middleware** (`middleware.ts` + `lib/supabase/middleware.ts`): atualiza o
  cookie de sessão do Supabase a cada requisição, seguindo o padrão oficial
  `@supabase/ssr` para Next.js App Router.

## 2. Pré-requisitos

- Node.js 18.18+ (recomendado 20+)
- Uma conta e um projeto no [Supabase](https://supabase.com) (plano gratuito serve)

## 3. Configurando o Supabase

1. Crie um projeto em [supabase.com](https://supabase.com/dashboard).
2. Abra **SQL Editor** no painel do Supabase, cole o conteúdo de
   `supabase/migrations/0001_init.sql` e execute (ou use a CLI: `supabase db push`,
   veja seção 7). Isso cria:
   - todas as tabelas (`profiles`, `products`, `materia_prima`, `reunioes`,
     `agenda_eventos`, `lists`, `checklist_base`, `sla_config`, `feriados`,
     `app_settings`);
   - as políticas de **Row Level Security (RLS)** de cada tabela;
   - o gatilho que cria automaticamente um `profile` para cada novo usuário
     autenticado (o **primeiro** e-mail cadastrado no sistema vira `admin`
     automaticamente; os demais entram como `member` e podem ser promovidos
     depois na tela **Usuários**);
   - o bucket privado de Storage `backups` (para os backups diários em JSON).
3. Em **Project Settings → API**, copie a **Project URL** e a **anon public key**.
4. (Opcional, recomendado para uso interno) em **Authentication → Providers →
   Email**, desative "Confirm email" se quiser que o primeiro acesso já entre
   direto após o cadastro, sem precisar confirmar por e-mail.

Nenhuma chave `service_role` é necessária — todo o controle de acesso é feito via
RLS com a `anon key` pública. Isso é intencional: manter apenas as duas variáveis
públicas como segredo simplifica o deploy e evita expor uma credencial poderosa.

## 4. Variáveis de ambiente

Copie o arquivo de exemplo e preencha com os dados do seu projeto:

```bash
cp .env.local.example .env.local
```

```
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua-anon-key-publica
```

Essas são as **únicas** variáveis necessárias.

## 5. Rodando localmente

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000). Na tela de login, use
**"Primeiro acesso? Criar conta com este e-mail e senha"** para criar o primeiro
usuário (que se torna administrador automaticamente).

## 6. Deploy na Vercel

1. Suba este repositório para o GitHub.
2. Em [vercel.com/new](https://vercel.com/new), importe o repositório (o Vercel
   detecta Next.js automaticamente — não é preciso configurar build command).
3. Em **Environment Variables**, adicione as mesmas duas variáveis do `.env.local`.
4. Deploy. Pronto — não há nenhum outro segredo a configurar.

## 7. (Opcional) Usando a CLI do Supabase para migrações

```bash
npm install -g supabase
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push   # aplica supabase/migrations/0001_init.sql
```

## 8. O que foi migrado para o Supabase

| Domínio (antes em `localStorage`) | Tabela/recurso Supabase |
|---|---|
| Login/usuários (`rp2_users`) | Supabase Auth + tabela `profiles` |
| Produtos (`rp2_data`) | tabela `products` (jsonb `etapas`) |
| Matéria-prima (`rp2_mp`) | tabela `materia_prima` |
| Reuniões (`rp2_pr`) | tabela `reunioes` |
| Agenda/treinamentos (`rp2_agenda`) | tabela `agenda_eventos` |
| Listas editáveis — marcas/linhas/tipos (`rp2_lists`) | tabela `lists` |
| Checklist por etapa (`rp2_checklist_base`) | tabela `checklist_base` |
| SLA (`rp2_sla`) | tabela `sla_config` |
| Feriados/pontes (`rp2_feriados*`) | tabela `feriados` |
| Backup diário (JSON) | Supabase Storage, bucket privado `backups` + tabela `app_settings` |
| **Tema (claro/escuro/sistema)** | permanece em `localStorage` — é uma preferência puramente visual do navegador, não faz sentido sincronizar entre dispositivos |

## 9. Decisões de design importantes (leia antes de usar em produção)

Como o projeto usa **apenas a `anon key`** (sem `service_role`), algumas ações
administrativas que exigiriam a Admin API do Supabase foram adaptadas para
funcionar com RLS + Auth padrão:

- **Criar usuário** (tela Usuários → "+ Convidar Usuário"): usa
  `supabase.auth.signUp()` num cliente Supabase **isolado** (sem persistir sessão),
  para não substituir a sessão do admin logado. O admin define uma senha
  temporária e repassa à pessoa.
- **Redefinir senha de outro usuário**: não é possível definir diretamente sem
  `service_role`. Em vez disso, o botão "🔑 Redefinir senha" dispara o e-mail
  oficial de redefinição do Supabase (`resetPasswordForEmail`) para o usuário.
- **Remover usuário**: não implementado (excluir contas de `auth.users` exige a
  Admin API/`service_role`). Um admin pode "rebaixar" outro usuário (tornar
  colaborador), mas a exclusão de conta precisa ser feita manualmente no painel
  do Supabase (Authentication → Users) ou via uma Edge Function futura com
  `service_role`, fora do escopo deste projeto para manter apenas as duas
  variáveis públicas como segredo.
- **Modelo de RLS**: é uma aplicação de uso interno por uma única equipe — por
  isso qualquer usuário autenticado pode ler/gravar os dados de negócio
  (produtos, reuniões, matéria-prima, etc.). A tabela `profiles` é a exceção:
  qualquer autenticado pode listar, mas só o próprio usuário ou um admin pode
  editar um perfil (e só um admin pode alterar o campo `role`).

## 10. Avisos conhecidos (não bloqueiam o funcionamento)

- `npm audit` acusa CVEs conhecidos da linha `next@14.x` cujo fix definitivo é a
  migração para o Next.js 16 (major com breaking changes). Optamos por manter a
  última versão patch da série 14 (`14.2.35`) para preservar 100% de
  compatibilidade com o restante do stack testado neste projeto. Recomenda-se
  avaliar a migração para Next 16 como próximo passo de manutenção.
- Durante o build você pode ver um aviso do Next tentando otimizar (inlinar) as
  fontes do Google Fonts — se o ambiente de build não tiver acesso a
  `fonts.googleapis.com`, o aviso aparece mas **não interrompe o build**; as
  fontes continuam sendo carregadas normalmente em runtime via `<link>` no
  `app/layout.tsx`.
- Um aviso do `@supabase/supabase-js` sobre `process.version` no Edge Runtime é
  esperado (dependência interna do SDK) e não afeta o funcionamento do
  middleware em produção/Vercel.

## 11. Estrutura de pastas

```
regulapro/
├── app/
│   ├── _markup/dashboard.html   # HTML original do painel (login + shell + páginas + modais)
│   ├── AppBootstrap.tsx         # cria o cliente Supabase e carrega o script legado
│   ├── globals.css              # CSS original do painel, na íntegra
│   ├── layout.tsx               # layout raiz (fontes, metadata)
│   └── page.tsx                 # renderiza o markup + monta o AppBootstrap
├── lib/supabase/
│   ├── client.ts                # cliente Supabase para o navegador
│   ├── server.ts                # cliente Supabase para Server Components/Route Handlers
│   └── middleware.ts            # helper de refresh de sessão usado pelo middleware.ts
├── middleware.ts                # middleware do Next.js (raiz)
├── public/legacy/app.js         # lógica de negócio original, persistência migrada p/ Supabase
├── supabase/migrations/0001_init.sql  # schema completo + RLS + triggers + storage
├── .env.local.example
└── package.json
```
