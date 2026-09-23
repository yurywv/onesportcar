"use client";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/action";

type Action = (state: ActionState, fd: FormData) => Promise<ActionState>;

export function ActionForm({
  action, children, className, reset, onDone, confirm: confirmMsg, id,
}: { action: Action; children: ReactNode; className?: string; reset?: boolean; onDone?: (s: ActionState) => void; confirm?: string; id?: string }) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      if (reset) ref.current?.reset();
      onDone?.(state);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form
      id={id}
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => { if (confirmMsg && !window.confirm(confirmMsg)) e.preventDefault(); }}
    >
      {children}
      <FormMessage state={state} />
    </form>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.error) return <p role="alert" className="alert alert-error mt-3" key={state.at}>{state.error}</p>;
  if (state.ok)
    return (
      <div role="status" className="alert alert-ok mt-3" key={state.at}>
        {state.ok}
        {state.data?.link && <LinkBox link={state.data.link} />}
      </div>
    );
  return null;
}

export function Submit({ children, className = "btn btn-primary", name, value, disabled }: { children: ReactNode; className?: string; name?: string; value?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled} name={name} value={value}>
      {pending ? "Salvando…" : children}
    </button>
  );
}

function LinkBox({ link }: { link: string }) {
  return (
    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
      <input readOnly value={link} className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(link)}>Copiar</button>
      <a className="btn btn-sm" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent("Seu orçamento OneSportcar está disponível para aprovação: " + link)}`}>WhatsApp</a>
    </div>
  );
}
