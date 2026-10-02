import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseCatalog } from '../../game/catalogSchema';
import { nextFreeDeckId } from '../../game/decks';
import type { CardDef, CardRarity, Catalog, DeckDef, PowerWeights } from '../../game/types';
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
  // Limite d'exemplaires par rareté (onglet « Paramètres »). `null` = sans limite.
  setMaxCopies: (rarity: CardRarity, max: number | null) => void;
  // Decks à choisir (V2, onglet « Decks »). `addDeck` rend l'id du deck créé ; `source` = deck
  // à dupliquer.
  addDeck: (source?: DeckDef) => string;
  renameDeck: (id: string, name: string) => void;
  removeDeck: (id: string) => void;
  // Déplace un deck dans la liste (-1 vers le haut). Le premier est le deck par défaut.
  moveDeck: (id: string, delta: number) => void;
  setDeckCount: (deckId: string, cardId: string, count: number) => void;
}

// Exemplaires d'une carte, sans la clé quand il n'y en a plus (même forme que la validation).
function withCount(counts: Record<string, number>, cardId: string, count: number): Record<string, number> {
  const { [cardId]: _removed, ...rest } = counts;
  return count > 0 ? { ...rest, [cardId]: count } : rest;
}

// Applique `fn` aux exemplaires de chaque deck (renommage ou suppression d'une carte).
function mapDeckCounts(
  current: Catalog,
  fn: (counts: Record<string, number>) => Record<string, number>,
): Pick<Catalog, 'decks'> {
  return current.decks ? { decks: current.decks.map((deck) => ({ ...deck, counts: fn(deck.counts) })) } : {};
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
        const move = (counts: Record<string, number>) => withCount(withCount(counts, id, 0), next.id, counts[id] ?? 0);
        return { ...current, cards, starterCounts: move(current.starterCounts), ...mapDeckCounts(current, move) };
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
        const drop = (counts: Record<string, number>) => withCount(counts, id, 0);
        return {
          ...current,
          cards: current.cards.filter((card) => card.id !== id),
          starterCounts: drop(current.starterCounts),
          ...mapDeckCounts(current, drop),
        };
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

  // Barème de puissance (onglet « Paramètres »). Remplacé en bloc : le panneau reconstruit
  // l'objet entier à chaque frappe, ce qui garde le brouillon immuable comme le reste.
  const setPowerWeights = useCallback(
    (weights: PowerWeights) => {
      mutate((current) => ({ ...current, powerWeights: weights }));
    },
    [mutate],
  );

  const setMaxCopies = useCallback(
    (rarity: CardRarity, max: number | null) => {
      mutate((current) => {
        const { [rarity]: _removed, ...rest } = current.maxCopiesByRarity ?? {};
        const limits = max === null ? rest : { ...rest, [rarity]: max };
        // Plus aucune limite : on retire la clé, comme la validation le ferait.
        const { maxCopiesByRarity: _old, ...base } = current;
        return Object.keys(limits).length > 0 ? { ...base, maxCopiesByRarity: limits } : base;
      });
    },
    [mutate],
  );

  const addDeck = useCallback(
    (source?: DeckDef) => {
      // L'id est calculé sur le brouillon du rendu courant : deux ajouts dans le même rendu sont
      // impossibles depuis l'interface (un clic = un rendu).
      const id = nextFreeDeckId(draft?.decks ?? []);
      const deck: DeckDef = source
        ? { id, name: `${source.name} (copie)`, counts: { ...source.counts } }
        : { id, name: 'Nouveau deck', counts: {} };
      mutate((current) => ({ ...current, decks: [...(current.decks ?? []), deck] }));
      return id;
    },
    [draft, mutate],
  );

  const updateDeck = useCallback(
    (id: string, fn: (deck: DeckDef) => DeckDef) => {
      mutate((current) => ({
        ...current,
        decks: (current.decks ?? []).map((deck) => (deck.id === id ? fn(deck) : deck)),
      }));
    },
    [mutate],
  );

  const renameDeck = useCallback(
    (id: string, name: string) => updateDeck(id, (deck) => ({ ...deck, name })),
    [updateDeck],
  );

  const setDeckCount = useCallback(
    (deckId: string, cardId: string, count: number) =>
      updateDeck(deckId, (deck) => ({ ...deck, counts: withCount(deck.counts, cardId, count) })),
    [updateDeck],
  );

  const removeDeck = useCallback(
    (id: string) => {
      mutate((current) => ({ ...current, decks: (current.decks ?? []).filter((deck) => deck.id !== id) }));
    },
    [mutate],
  );

  const moveDeck = useCallback(
    (id: string, delta: number) => {
      mutate((current) => {
        const decks = [...(current.decks ?? [])];
        const from = decks.findIndex((deck) => deck.id === id);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= decks.length) return current;
        const [deck] = decks.splice(from, 1);
        decks.splice(to, 0, deck);
        return { ...current, decks };
      });
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
    addDeck,
    renameDeck,
    removeDeck,
    moveDeck,
    setDeckCount,
    addCard,
    removeCard,
    setCount,
    setPowerWeights,
    setMaxCopies,
  };
}
