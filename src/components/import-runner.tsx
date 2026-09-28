"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { importNextChunk, revertNextChunk } from "@/app/(app)/admin/importacao/actions";

/** Executa importação ou reversão em blocos, chamando o servidor em laço (cada chamada cabe no limite de tempo da Vercel). */
export function ImportRunner({ jobId, mode, pending, label }: { jobId: string; mode: "import" | "revert"; pending: number; label: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ done: number; issues: number; running: boolean; error?: string } | null>(null);
  const start = async () => {
    const msg = mode === "import"
      ? `Importar ${pending} registro(s)? Os cadastros serão criados e a operação ficará na auditoria.`
      : "Reverter esta importação? Registros ainda não usados serão removidos; os que já têm vínculos serão mantidos.";
    if (!window.confirm(msg)) return;
    let done = 0, issues = 0;
    setState({ done, issues, running: true });
    for (;;) {
      const r = mode === "import" ? await importNextChunk(jobId) : await revertNextChunk(jobId);
      if (!r.ok) { setState({ done, issues, running: false, error: r.error }); break; }
      done += "done" in r ? r.done : r.reverted;
      issues += "failed" in r ? r.failed : r.blocked;
      setState({ done, issues, running: r.remaining > 0 });
      if (!r.remaining) break;
    }
    router.refresh();
  };
  return (
    <div className="space-y-2">
      <button type="button" className={mode === "import" ? "btn btn-primary" : "btn btn-danger"} disabled={!!state?.running || pending === 0} onClick={start}>
        {state?.running ? `${mode === "import" ? "Importando" : "Revertendo"}… ${state.done}/${pending}` : label}
      </button>
      {state && !state.running && !state.error && (
        <p className="alert alert-ok">{mode === "import" ? `${state.done} registro(s) importado(s)` : `${state.done} registro(s) revertido(s)`}{state.issues ? ` · ${state.issues} com problema (veja a lista)` : ""}.</p>
      )}
      {state?.error && <p className="alert alert-error">{state.error}</p>}
    </div>
  );
}
