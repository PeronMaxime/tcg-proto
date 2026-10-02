import { useEffect, useState } from 'react';
import {
  DEFAULT_GAME_VERSION,
  GAME_VERSION_LABELS,
  GAME_VERSIONS,
  isGameVersion,
  type GameVersion,
} from '../../game/versions';
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
import DecksPanel from './DecksPanel';
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
// « Decks » n'existe qu'en V2 : la V1 garde un deck de départ commun, réglé carte par carte.
const TABS = [
  { id: 'cards', label: 'Cartes' },
  { id: 'decks', label: 'Decks', versions: ['v2'] },
  { id: 'table', label: 'Récapitulatif' },
  { id: 'stats', label: 'Chiffres' },
  { id: 'settings', label: 'Paramètres' },
] as const satisfies readonly { id: string; label: string; versions?: readonly GameVersion[] }[];

type TabId = (typeof TABS)[number]['id'];

function tabsFor(version: GameVersion) {
  return TABS.filter((entry) => !('versions' in entry) || (entry.versions as readonly GameVersion[]).includes(version));
}

// Version du jeu éditée (sélecteur en haut à droite), retenue d'une visite à l'autre : on
// retravaille en général plusieurs jours de suite sur la même.
const VERSION_KEY = 'tcg-admin-game-version';

function loadVersion(): GameVersion {
  try {
    const stored = localStorage.getItem(VERSION_KEY);
    return isGameVersion(stored) ? stored : DEFAULT_GAME_VERSION;
  } catch {
    return DEFAULT_GAME_VERSION;
  }
}

function saveVersion(version: GameVersion): void {
  try {
    localStorage.setItem(VERSION_KEY, version);
  } catch {
    // stockage indisponible : le choix vaut pour cette visite seulement
  }
}

interface VersionPickerProps {
  value: GameVersion;
  onChange: (version: GameVersion) => void;
  disabled: boolean;
}

function VersionPicker({ value, onChange, disabled }: VersionPickerProps) {
  return (
    <div className="admin-version">
      <span>Version du jeu</span>
      <div className="admin-version-options" role="radiogroup">
        {GAME_VERSIONS.map((version) => (
          <button
            key={version}
            type="button"
            role="radio"
            aria-checked={value === version}
            className={value === version ? 'selected' : undefined}
            onClick={() => onChange(version)}
            disabled={disabled}
          >
            {GAME_VERSION_LABELS[version]}
          </button>
        ))}
      </div>
    </div>
  );
}

function AdminScreen() {
  // undefined = Firebase n'a pas encore tranché, null = personne n'est connecté.
  const [session, setSession] = useState<AdminSession | null | undefined>(
    isAuthAvailable ? undefined : null,
  );
  const [tab, setTab] = useState<TabId>('cards');
  const [version, setVersion] = useState(loadVersion);
  const admin = useCatalogAdmin(version);

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

  function changeVersion(next: GameVersion) {
    if (next === version) return;
    // Le brouillon est propre à une version : en changer le perd.
    if (
      admin.dirty &&
      !window.confirm(
        `Les modifications non enregistrées de la ${GAME_VERSION_LABELS[version]} seront perdues. Changer de version quand même ?`,
      )
    ) {
      return;
    }
    setVersion(next);
    saveVersion(next);
  }

  const visibleTabs = tabsFor(version);
  // Onglet absent de la version affichée (« Decks » en V1) : on retombe sur les cartes.
  const activeTab: TabId = visibleTabs.some((entry) => entry.id === tab) ? tab : 'cards';

  const versionPicker = <VersionPicker value={version} onChange={changeVersion} disabled={admin.saving} />;
  const label = GAME_VERSION_LABELS[version];

  if (admin.status === 'loading') {
    return (
      <div className="menu">
        {versionPicker}
        <p>Chargement du catalogue de la {label}…</p>
      </div>
    );
  }

  if (admin.status === 'error') {
    return (
      <div className="menu">
        {versionPicker}
        <h1>Administration</h1>
        <p className="error">{admin.failure}</p>
        <button onClick={() => void admin.reload()}>Réessayer</button>
      </div>
    );
  }

  // Premier lancement : rien n'a encore été enregistré. On ne migre pas automatiquement —
  // écrire dans un stockage partagé doit rester un geste explicite.
  //
  // Pour une version suivante, le point de départ est une copie de la V1 : un catalogue vide
  // n'est pas valide, et la V1 elle-même n'est pas touchée.
  if (admin.status === 'missing') {
    const local = catalogStore.isLocal ? ' sur cette machine' : '';
    return (
      <div className="menu">
        {versionPicker}
        <h1>Administration</h1>
        {version === 'v1' ? (
          <p>
            Aucun catalogue n’est encore enregistré pour la {label}{local}. Importe les cartes livrées
            avec le jeu pour commencer à les modifier.
          </p>
        ) : (
          <p>
            La {label} n’a pas encore de cartes{local}. Pars d’une copie des cartes de la{' '}
            {GAME_VERSION_LABELS[DEFAULT_GAME_VERSION]} : tu pourras ensuite les modifier, en supprimer
            et en ajouter sans rien changer à la {GAME_VERSION_LABELS[DEFAULT_GAME_VERSION]}.
            {version === 'v2' &&
              ' Ce qui n’existe pas en V2 (auras, bonus permanents, dégâts bonus, enchantements sans équivalent…) est retiré de la copie.'}
          </p>
        )}
        <button onClick={() => void admin.seed()} disabled={admin.saving}>
          {admin.saving
            ? 'Import…'
            : version === 'v1'
              ? 'Importer les cartes livrées avec le jeu'
              : `Copier les cartes de la ${GAME_VERSION_LABELS[DEFAULT_GAME_VERSION]}`}
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

      <div className="admin-topbar">
        <nav className="admin-tabs">
          {visibleTabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === activeTab ? 'admin-tab is-active' : 'admin-tab'}
              aria-current={entry.id === activeTab ? 'page' : undefined}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
        {versionPicker}
      </div>

      {activeTab === 'cards' && <CatalogPanel admin={admin} />}
      {activeTab === 'decks' && <DecksPanel admin={admin} />}
      {activeTab === 'table' && <CardsTable admin={admin} />}
      {activeTab === 'stats' && <CatalogStats admin={admin} />}
      {activeTab === 'settings' && <PowerWeightsPanel admin={admin} />}

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
