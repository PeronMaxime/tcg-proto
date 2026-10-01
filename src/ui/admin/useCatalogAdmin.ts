import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseCatalog } from '../../game/catalogSchema';
import type { CardDef, Catalog, PowerWeights } from '../../game/types';
import type { GameVersion } from '../../game/versions';
import { catalogStore, seedCatalog } from '../../net/catalogStore';
import { applyCatalog } from '../applyCatalog';

// État du panneau d'administration : un brouillon en mémoire, modifié librement, puis
// enregistré d'un bloc. Le brouillon est installé comme catalogue actif à chaque changement,
// ce qui donne l'aperçu en direct sans code de rendu dédié (voir `CardPreview`).
//
// Le brouillon est celui d'UNE version du jeu (`version`, choisie en haut du panneau) : en
// changer recharge le catalogue de l'autre version et abandonne le brouillon en cours.

export type CatalogStatus = 'loading' | 'missing' | 'ready' | 'error';

export interface CatalogAdmin {
  // Version du jeu éditée : elle fixe les habiletés et les effets proposés par les onglets.
  version: GameVersion;
  status: CatalogStatus;
  draft: Catalog | null;
  // Erreurs bloquantes du brouillon entier (`parseCatalog`) : tant qu'il y en a, on n'écrit pas.
  errors: string[];
  // Message d'échec de chargement ou d'enregistrement, distinct des erreurs de validation.
  failure: string | null;
  dirty: boolean;
  saving: boolean;
  seed: () => Promise<void>;
  save: () => Promise<void>;
  reload: () => Promise<void>;
  updateCard: (id: string, next: CardDef) => void;
  addCard: (card: CardDef) => void;
  removeCard: (id: string) => void;
  setCount: (id: string, count: number) => void;
  setPowerWeights: (weights: PowerWeights) => void;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : 'Erreur inconnue.';
}

export function useCatalogAdmin(version: GameVersion): CatalogAdmin {
  const [status, setStatus] = useState<CatalogStatus>('loading');
  const [draft, setDraft] = useState<Catalog | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Évite un `setState` sur un composant démonté si le chargement se termine après coup.
  // Le drapeau est REMIS À VRAI à chaque montage : en mode développement, `StrictMode` monte,
  // démonte puis remonte le composant, et un drapeau qui resterait faux après le premier
  // démontage ferait ignorer tous les `setState` suivants — l'écran resterait en chargement.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Numéro du dernier chargement lancé : si l'on change de version avant la fin d'une lecture,
  // son résultat (le catalogue de l'ANCIENNE version) doit être ignoré.
  const loadId = useRef(0);

  const reload = useCallback(async () => {
    const id = ++loadId.current;
    setStatus('loading');
    setFailure(null);
    setDraft(null);
    setDirty(false);
    try {
      const loaded = await catalogStore.load(version);
      if (!alive.current || id !== loadId.current) return;
      setDraft(loaded);
      setDirty(false);
      setStatus(loaded ? 'ready' : 'missing');
    } catch (e) {
      if (!alive.current || id !== loadId.current) return;
      setFailure(message(e));
      setStatus('error');
    }
  }, [version]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Aperçu en direct : tout ce qui est rendu après ce point (y compris les faces de cartes
  // dessinées par `textures.ts`) utilise le brouillon, pas le catalogue enregistré.
  //
  // Installé pendant le rendu, comme dans `RoomScreen`, et non dans un effet : les effets des
  // composants ENFANTS se déclenchent avant ceux du parent, si bien que `CardPreview` lirait
  // encore l'ancienne face en cache. Chaque modification produit un nouvel objet `draft`, donc
  // la comparaison de référence applique exactement une fois par changement.
  const applied = useRef<Catalog | null>(null);
  if (draft && applied.current !== draft) {
    applyCatalog(draft);
    applied.current = draft;
  }

  const errors = useMemo(() => {
    if (!draft) return [];
    const parsed = parseCatalog(draft, version);
    return parsed.ok ? [] : parsed.errors;
  }, [draft, version]);

  const mutate = useCallback((fn: (current: Catalog) => Catalog) => {
    setDraft((current) => (current ? fn(current) : current));
    setDirty(true);
  }, []);

  const updateCard = useCallback(
    (id: string, next: CardDef) => {
      mutate((current) => {
        const cards = current.cards.map((card) => (card.id === id ? next : card));
        // L'id est aussi la clé de `starterCounts` : le renommer doit déplacer le compteur,
        // sinon la carte sortirait du deck de départ sans que rien ne le dise.
        if (next.id === id) return { ...current, cards };
        const { [id]: count, ...rest } = current.starterCounts;
        return {
          ...current,
          cards,
          starterCounts: count === undefined ? rest : { ...rest, [next.id]: count },
        };
      });
    },
    [mutate],
  );

  const addCard = useCallback(
    (card: CardDef) => {
      // Une carte neuve entre à 0 exemplaire : elle existe dans le catalogue mais n'est pas
      // distribuée tant qu'on ne lui en donne pas, ce qui permet de la préparer tranquillement.
      mutate((current) => ({ ...current, cards: [...current.cards, card] }));
    },
    [mutate],
  );

  const removeCard = useCallback(
    (id: string) => {
      mutate((current) => {
        const { [id]: _removed, ...starterCounts } = current.starterCounts;
        return { ...current, cards: current.cards.filter((card) => card.id !== id), starterCounts };
      });
    },
    [mutate],
  );

  const setCount = useCallback(
    (id: string, count: number) => {
      mutate((current) => {
        if (count <= 0) {
          const { [id]: _removed, ...starterCounts } = current.starterCounts;
          return { ...current, starterCounts };
        }
        return { ...current, starterCounts: { ...current.starterCounts, [id]: count } };
      });
    },
    [mutate],
  );

  // Barème de puissance (onglet « Puissances »). Remplacé en bloc : le panneau reconstruit
  // l'objet entier à chaque frappe, ce qui garde le brouillon immuable comme le reste.
  const setPowerWeights = useCallback(
    (weights: PowerWeights) => {
      mutate((current) => ({ ...current, powerWeights: weights }));
    },
    [mutate],
  );

  const save = useCallback(async () => {
    if (!draft || errors.length > 0) return;
    // Même garde que `reload` : une écriture terminée après un changement de version ne doit
    // pas installer son catalogue dans le brouillon de l'autre version.
    const id = loadId.current;
    setSaving(true);
    setFailure(null);
    try {
      const saved = await catalogStore.save(version, draft);
      if (!alive.current || id !== loadId.current) return;
      setDraft(saved);
      setDirty(false);
      setStatus('ready');
    } catch (e) {
      if (!alive.current || id !== loadId.current) return;
      setFailure(message(e));
    } finally {
      if (alive.current) setSaving(false);
    }
  }, [version, draft, errors]);

  const seed = useCallback(async () => {
    const id = loadId.current;
    setSaving(true);
    setFailure(null);
    try {
      const seeded = await seedCatalog(version);
      if (!alive.current || id !== loadId.current) return;
      setDraft(seeded);
      setDirty(false);
      setStatus('ready');
    } catch (e) {
      if (!alive.current || id !== loadId.current) return;
      setFailure(message(e));
    } finally {
      if (alive.current) setSaving(false);
    }
  }, [version]);

  return {
    version,
    status,
    draft,
    errors,
    failure,
    dirty,
    saving,
    seed,
    save,
    reload,
    updateCard,
    addCard,
    removeCard,
    setCount,
    setPowerWeights,
  };
}
