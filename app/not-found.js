import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found-shell">
      <div className="not-found-card">
        <p className="eyebrow">Página não encontrada</p>
        <h1>Esse caminho não existe no cardápio.</h1>
        <p className="not-found-copy">
          Você pode voltar para a página principal e continuar seu pedido.
        </p>
        <Link className="primary-link" href="/">
          Voltar ao cardápio
        </Link>
      </div>
    </main>
  );
}
