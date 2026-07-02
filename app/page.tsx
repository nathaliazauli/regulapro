import fs from "node:fs";
import path from "node:path";
import AppBootstrap from "./AppBootstrap";

// O HTML abaixo é o mesmo markup do painel original (login + shell do app +
// todas as páginas/modais), preservado integralmente para manter 100% do
// layout e da experiência do usuário. A lógica de negócio (antes em
// localStorage) foi portada para o Supabase em public/legacy/app.js.
function getDashboardMarkup() {
  const filePath = path.join(process.cwd(), "app", "_markup", "dashboard.html");
  return fs.readFileSync(filePath, "utf8");
}

export default function Page() {
  const markup = getDashboardMarkup();

  return (
    <>
      <div id="regulapro-root" dangerouslySetInnerHTML={{ __html: markup }} />
      <AppBootstrap />
    </>
  );
}
