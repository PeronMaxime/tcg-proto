import { useEffect, useState } from 'react';
import {
  isAuthAvailable,
  signOutAdmin,
  subscribeToAdminSession,
  type AdminSession,
} from '../../net/auth';
import { catalogStore } from '../../net/catalogStore';
import CardsTable from './CardsTable';
import CatalogPanel from './CatalogPanel';
import CatalogStats from './CatalogStats';
import LoginForm from './LoginForm';
import PowerWeightsPanel from './PowerWeightsPanel';
import { useCatalogAdmin } from './useCatalogAdmin';

// Panneau d'administration, servi sur `/admin` (voir `App.tsx`).
//
// En mode local (pas de configuration Firebase), il n'y a rien à authentifier : le catalogue
// vit dans le localStorage de cette machine et n'est visible que d'ici. La connexion n'apparaît
// donc qu'en mode Firebase, où le catalogue est partagé entre tous les joueurs.

// Onglets du panneau. Ils partagent tous LE MÊME brouillon (`useCatalogAdmin`) : changer
// d'onglet ne perd rien, et le bouton « Enregistrer » de n'importe quel onglet écrit le
// catalogue entier. L'ordre est celui du travail : éditer, relire, compter, peser.
const TABS = [
  { id: 'cards', label: 'Cartes' },
  { id: 'table', label: 'Récapitulatif' },
  { id: 'stats', label: 'Chiffres' },
  { id: 'power', label: 'Puissances' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function AdminScreen() {
  // undefined = Firebase n'a pas encore tranché, null = personne n'est connecté.
  const [session, setSession] = useState<AdminSession | null | undefined>(
    isAuthAvailable ? undefined : null,
  );
  const [tab, setTab] = useState<TabId>('cards');
  const admin = useCatalogAdmin();

  useEffect(() => subscribeToAdminSession(setSession), []);

  const authenticated = !isAuthAvailable || (session !== null && session !== undefined && session.isAdmin);

  if (isAuthAvailable && session === undefined) {
    return <p>Vérification de la session…</p>;
  }

  if (isAuthAvailable && session === null) {
    return <LoginForm onSignedIn={() => void admin.reload()} />;
  }

  if (isAuthAvailable && session && !session.isAdmin) {
    return (
      <div className="menu">
        <h1>Administration</h1>
        <p className="error">
          Ce compte ({session.email}) n’est pas administrateur. Son identifiant est{' '}
          <code>{session.uid}</code> : ajoute-le à <code>VITE_ADMIN_UIDS</code> et à{' '}
          <code>firestore.rules</code> pour l’autoriser.
        </p>
        <button onClick={() => void signOutAdmin()}>Se déconnecter</button>
      </div>
    );
  }

  if (!authenticated) return null;

  if (admin.status === 'loading') return <p>Chargement du catalogue…</p>;

  if (admin.status === 'error') {
    return (
      <div className="menu">
        <h1>Administration</h1>
        <p className="error">{admin.failure}</p>
        <button onClick={() => void admin.reload()}>Réessayer</button>
      </div>
    );
  }

  // Premier lancement : rien n'a encore été enregistré. On ne migre pas automatiquement —
  // écrire dans un stockage partagé doit rester un geste explicite.
  if (admin.status === 'missing') {
    return (
      <div className="menu">
        <h1>Administration</h1>
        <p>
          Aucun catalogue n’est encore enregistré{catalogStore.isLocal ? ' sur cette machine' : ''}. Importe
          les cartes livrées avec le jeu pour commencer à les modifier.
        </p>
        <button onClick={() => void admin.seed()} disabled={admin.saving}>
          {admin.saving ? 'Import…' : 'Importer les cartes livrées avec le jeu'}
        </button>
        {admin.failure && <p className="error">{admin.failure}</p>}
      </div>
    );
  }

  return (
    <div className="admin">
      {catalogStore.isLocal && (
        <p className="badge-local">
          Mode local — ce catalogue est enregistré dans ce navigateur uniquement. Configure Firebase
          (README §2) pour le partager entre plusieurs machines.
        </p>
      )}

      <nav className="admin-tabs">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={entry.id === tab ? 'admin-tab is-active' : 'admin-tab'}
            aria-current={entry.id === tab ? 'page' : undefined}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === 'cards' && <CatalogPanel admin={admin} />}
      {tab === 'table' && <CardsTable admin={admin} />}
      {tab === 'stats' && <CatalogStats admin={admin} />}
      {tab === 'power' && <PowerWeightsPanel admin={admin} />}

      <footer className="admin-footer">
        <a href="/">← Retour au jeu</a>
        {isAuthAvailable && session && (
          <button onClick={() => void signOutAdmin()}>Se déconnecter ({session.email})</button>
        )}
      </footer>
    </div>
  );
}

export default AdminScreen;
