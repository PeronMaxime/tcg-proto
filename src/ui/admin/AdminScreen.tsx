import { useEffect, useState } from 'react';
import {
  isAuthAvailable,
  signOutAdmin,
  subscribeToAdminSession,
  type AdminSession,
} from '../../net/auth';
import { catalogStore } from '../../net/catalogStore';
import CatalogPanel from './CatalogPanel';
import LoginForm from './LoginForm';
import { useCatalogAdmin } from './useCatalogAdmin';

// Panneau d'administration, servi sur `/admin` (voir `App.tsx`).
//
// En mode local (pas de configuration Firebase), il n'y a rien à authentifier : le catalogue
// vit dans le localStorage de cette machine et n'est visible que d'ici. La connexion n'apparaît
// donc qu'en mode Firebase, où le catalogue est partagé entre tous les joueurs.

function AdminScreen() {
  // undefined = Firebase n'a pas encore tranché, null = personne n'est connecté.
  const [session, setSession] = useState<AdminSession | null | undefined>(
    isAuthAvailable ? undefined : null,
  );
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

      <CatalogPanel admin={admin} />

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
