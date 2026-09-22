import type { ReactNode } from 'react';
import type { CatalogAdmin } from './useCatalogAdmin';

// En-tête commun à tous les onglets du panneau d'administration : titre, résumé, actions
// propres à l'onglet, puis le bouton d'enregistrement et les erreurs du brouillon.
//
// Le brouillon est UNIQUE pour tout le panneau (`useCatalogAdmin`), pas un par onglet : le
// bouton « Enregistrer » écrit le catalogue entier, cartes et barème de puissance compris,
// d'où qu'on clique. Le répéter dans chaque onglet évite d'avoir à revenir sur celui des
// cartes pour enregistrer une modification faite ailleurs.

interface AdminHeaderProps {
  title: string;
  summary?: ReactNode;
  admin: CatalogAdmin;
  children?: ReactNode; // actions propres à l'onglet, placées avant « Enregistrer »
}

function AdminHeader({ title, summary, admin, children }: AdminHeaderProps) {
  return (
    <>
      <header className="admin-header">
        <div>
          <h1>{title}</h1>
          {summary && <p className="admin-summary">{summary}</p>}
        </div>

        <div className="admin-actions">
          {children}
          <button
            type="button"
            className="admin-save"
            onClick={() => void admin.save()}
            disabled={!admin.dirty || admin.saving || admin.errors.length > 0}
          >
            {admin.saving ? 'Enregistrement…' : admin.dirty ? 'Enregistrer' : 'À jour'}
          </button>
        </div>
      </header>

      {admin.failure && <p className="error">{admin.failure}</p>}

      {admin.errors.length > 0 && (
        <div className="admin-errors-block">
          <p className="error">Le catalogue ne peut pas être enregistré tant que ceci n’est pas corrigé :</p>
          <ul className="admin-errors">
            {admin.errors.slice(0, 10).map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export default AdminHeader;
