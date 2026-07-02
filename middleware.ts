import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Roda em todas as rotas, exceto assets estáticos e arquivos internos do Next,
     * para manter a sessão do Supabase sempre atualizada.
     */
    "/((?!_next/static|_next/image|favicon.ico|legacy/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
