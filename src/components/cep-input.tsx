"use client";
/** Preenche endereço via ViaCEP ao sair do campo. Falha silenciosa: o preenchimento manual continua possível. */
export function CepInput({ defaultValue }: { defaultValue?: string }) {
  return (
    <input
      name="cep"
      className="input"
      inputMode="numeric"
      defaultValue={defaultValue}
      onBlur={async (e) => {
        const cep = e.currentTarget.value.replace(/\D/g, "");
        const form = e.currentTarget.form;
        if (cep.length !== 8 || !form) return;
        try {
          const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
          const d = await r.json();
          if (d.erro) return;
          const set = (n: string, v: string) => { const el = form.elements.namedItem(n) as HTMLInputElement | null; if (el && !el.value) el.value = v; };
          set("street", d.logradouro); set("district", d.bairro); set("city", d.localidade); set("uf", d.uf);
        } catch {}
      }}
    />
  );
}
