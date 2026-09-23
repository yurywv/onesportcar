"use client";
export function PrintButton() {
  return <button className="btn btn-primary no-print" onClick={() => window.print()}>Imprimir / salvar PDF</button>;
}
