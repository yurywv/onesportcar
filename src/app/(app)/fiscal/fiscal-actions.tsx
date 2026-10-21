import type { FiscalStatus } from "@prisma/client";
import { ActionForm, Submit } from "@/components/forms";
import { emitFiscalAction, refreshFiscalAction, cancelFiscalAction, discardFiscalAction } from "./actions";

export function FiscalActions({ doc, canEmit }: { doc: { id: string; status: FiscalStatus; pdfUrl: string | null; xmlUrl: string | null }; canEmit: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {doc.pdfUrl && <a href={doc.pdfUrl} target="_blank" rel="noreferrer" className="btn btn-sm">PDF</a>}
      {doc.xmlUrl && <a href={doc.xmlUrl} target="_blank" rel="noreferrer" className="btn btn-sm">XML</a>}
      {canEmit && ["RASCUNHO", "REJEITADA", "ERRO"].includes(doc.status) && (
        <>
          <ActionForm action={emitFiscalAction} confirm="Transmitir esta nota agora?"><input type="hidden" name="id" value={doc.id} /><Submit className="btn btn-sm btn-primary">Transmitir</Submit></ActionForm>
          {doc.status !== "REJEITADA" && <ActionForm action={discardFiscalAction} confirm="Descartar este rascunho?"><input type="hidden" name="id" value={doc.id} /><Submit className="btn btn-sm btn-ghost text-danger">Descartar</Submit></ActionForm>}
        </>
      )}
      {canEmit && doc.status === "PROCESSANDO" && (
        <ActionForm action={refreshFiscalAction}><input type="hidden" name="id" value={doc.id} /><Submit className="btn btn-sm">Atualizar status</Submit></ActionForm>
      )}
      {canEmit && doc.status === "AUTORIZADA" && (
        <details className="relative">
          <summary className="btn btn-sm list-none">Cancelar</summary>
          <div className="card absolute right-0 z-20 mt-1 w-72 p-3">
            <ActionForm action={cancelFiscalAction} confirm="Cancelar a nota junto à prefeitura/SEFAZ? Não pode ser desfeito.">
              <input type="hidden" name="id" value={doc.id} />
              <textarea name="reason" className="textarea" minLength={15} required placeholder="Justificativa (mín. 15 caracteres)" />
              <Submit className="btn btn-danger mt-2 w-full">Confirmar cancelamento</Submit>
            </ActionForm>
          </div>
        </details>
      )}
    </div>
  );
}
