import Link from "next/link";
export default function NoPermission() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <h1 className="text-xl font-semibold">Sem permissão</h1>
        <p className="mt-2 text-sm text-muted">Seu perfil não tem acesso a esta área.</p>
        <Link href="/" className="btn mt-4">Voltar ao início</Link>
      </div>
    </main>
  );
}
