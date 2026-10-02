import {
  ELEMENT_LABELS,
  isAbilityAllowed,
  isMonster,
  KEYWORD_LABELS,
  RARITY_LABELS,
  TRIGGER_LABELS,
  cardPower,
  cardRarity,
  describeKeywordEffect,
  powerBalance,
} from '../../game/cards';
import {
  CARD_RARITIES,
  MAX_COPIES,
  MAX_COST,
  MAX_STAT,
  TRIGGERS,
  abilityEffectTypesFor,
  elementsFor,
  enchantmentEffectTypesFor,
  keywordsFor,
  parseCardDef,
} from '../../game/catalogSchema';
import type {
  AbilityEffect,
  CardAbility,
  CardDef,
  CardElement,
  CardRarity,
  EnchantmentEffect,
  Keyword,
  MonsterDef,
  Trigger,
} from '../../game/types';
import type { GameVersion } from '../../game/versions';
import CardPreview from './CardPreview';

// Formulaire d'une carte. Il est piloté par les types de `game/types.ts` : chaque liste
// déroulante est bâtie sur les listes de `vocabulary.ts` de la version éditée, donc ajouter un
// effet ou une habileté au jeu le fait apparaître ici sans toucher à ce fichier.

// Exporté : l'onglet « Paramètres » nomme les mêmes effets. Les libellés V2 reprennent ceux de
// modifsV2.md.
export const ABILITY_EFFECT_LABELS: Record<AbilityEffect['type'], string> = {
  gainCoins: 'Gagne des pièces',
  damageOpponent: 'Inflige des dégâts au héros adverse',
  healSelf: 'Soigne ton héros',
  drawCard: 'Pioche des cartes',
  buff: 'Donne un bonus permanent',
  bonusDamage: 'Dégâts bonus sur ce coup',
  shield: 'Réduit les dégâts reçus',
  extraMarketCard: 'Cartes en plus au prochain marché',
  armorChosen: 'Donne de l’armure au monstre choisi',
  armorZone: 'Donne de l’armure aux monstres de sa zone',
  armorBoard: 'Donne de l’armure à tous tes monstres',
  armorSelf: 'Gagne de l’armure',
  grantShield: 'Ajoute une protection au monstre choisi',
  summonToken: 'Invoque une créature',
  burn: 'Brûle le monstre ciblé',
  freeze: 'Gèle le monstre ciblé',
  moveZone: 'Change le monstre ciblé de zone',
  moveSlot: 'Change le monstre ciblé de position',
  switchZone: 'Change de zone',
  extinguish: 'Éteint la brûlure du monstre choisi',
  root: 'Enracine le monstre ciblé',
  silence: 'Réduit au silence le monstre ciblé',
};

export const ENCHANTMENT_EFFECT_LABELS: Record<EnchantmentEffect['type'], string> = {
  monsterBuff: 'Bonus à tes monstres',
  coinsPerTurn: 'Pièces à chaque tour',
  healBoost: 'Double les soins reçus',
  marketSize: 'Cartes en plus à chaque marché',
  sellBonus: 'Pièces en plus à la vente',
};

const BUFF_TARGET_LABELS = { self: 'Lui-même', otherAllies: 'Tes autres monstres' } as const;
const BUFF_ZONE_LABELS = { attack: 'En attaque', defense: 'En défense', all: 'Partout' } as const;

// Effet neuf quand on change de type dans la liste : valeurs minimales valides, pour que le
// formulaire ne passe jamais par un état refusé à l'enregistrement.
function freshAbilityEffect(type: AbilityEffect['type']): AbilityEffect {
  switch (type) {
    case 'drawCard':
    case 'extraMarketCard':
      return { type, count: 1 };
    case 'buff':
      return { type, target: 'self', attack: 1, defense: 0 };
    case 'summonToken':
      return { type, attack: 1, defense: 1 };
    case 'grantShield':
    case 'burn':
    case 'freeze':
    case 'moveZone':
    case 'moveSlot':
    case 'switchZone':
    case 'extinguish':
    case 'root':
    case 'silence':
      return { type };
    default:
      return { type, amount: 1 };
  }
}

function freshEnchantmentEffect(type: EnchantmentEffect['type']): EnchantmentEffect {
  switch (type) {
    case 'coinsPerTurn':
    case 'sellBonus':
      return { type, amount: 1 };
    case 'marketSize':
      return { type, count: 1 };
    case 'healBoost':
      return { type };
    case 'monsterBuff':
      return { type, zone: 'all', attack: 1, defense: 0 };
  }
}

export function freshCard(kind: CardDef['kind'], id: string): CardDef {
  const base = {
    id,
    name: 'Nouvelle carte',
    cost: 2,
    element: 'fire' as CardElement,
    rarity: 'common' as CardRarity,
  };
  return kind === 'monster'
    ? { kind, ...base, attack: 1, defense: 1 }
    : { kind, ...base, effect: freshEnchantmentEffect('monsterBuff') };
}

interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

function NumberField({ label, value, min, max, onChange }: NumberFieldProps) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        // Un champ vidé donne NaN : on retombe sur le minimum plutôt que d'écrire NaN dans le
        // catalogue, où il traverserait les comparaisons de `rules.ts` sans bruit.
        onChange={(e) => onChange(Math.min(max, Math.max(min, Math.trunc(Number(e.target.value)) || min)))}
      />
    </label>
  );
}

interface AbilityRowProps {
  ability: CardAbility;
  def: CardDef;
  version: GameVersion;
  onChange: (next: CardAbility) => void;
  onRemove: () => void;
}

// Effets permis pour ce déclencheur sur cette carte, selon les règles de la version
// (`isAbilityAllowed` : bonus/bouclier sur leur déclencheur en V1, cible choisie seulement sur
// Invoqué / Vendu en V2…).
function allowedEffects(def: CardDef, trigger: Trigger, version: GameVersion): AbilityEffect['type'][] {
  return abilityEffectTypesFor(version).filter((type) =>
    isAbilityAllowed(def, { trigger, effect: freshAbilityEffect(type) }, version),
  );
}

function AbilityRow({ ability, def, version, onChange, onRemove }: AbilityRowProps) {
  const { trigger, effect } = ability;
  // Un déclencheur n'est proposé que s'il admet au moins un effet sur cette carte (E12 : un
  // enchantement ne combat pas, ses capacités de combat ne se déclencheraient jamais).
  const triggers = TRIGGERS.filter((t) => allowedEffects(def, t, version).length > 0);
  const effectTypes = allowedEffects(def, trigger, version);

  function setTrigger(next: Trigger) {
    // Changer de déclencheur peut rendre l'effet courant interdit : on le ramène au premier
    // effet encore permis plutôt que de laisser une capacité invalide.
    const allowed = allowedEffects(def, next, version);
    const stillAllowed = allowed.includes(effect.type);
    onChange({ ...ability, trigger: next, effect: stillAllowed ? effect : freshAbilityEffect(allowed[0]) });
  }

  return (
    <div className="admin-ability">
      <div className="admin-row">
        <label className="admin-field">
          <span>Déclencheur</span>
          <select value={trigger} onChange={(e) => setTrigger(e.target.value as Trigger)}>
            {triggers.map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="admin-field">
          <span>Effet</span>
          <select
            value={effect.type}
            onChange={(e) =>
              onChange({ ...ability, effect: freshAbilityEffect(e.target.value as AbilityEffect['type']) })
            }
          >
            {effectTypes.map((type) => (
              <option key={type} value={type}>
                {ABILITY_EFFECT_LABELS[type]}
              </option>
            ))}
          </select>
        </label>

        <button type="button" className="admin-remove" onClick={onRemove}>
          Retirer
        </button>
      </div>

      <div className="admin-row">
        {'amount' in effect && (
          <NumberField
            label="Valeur"
            value={effect.amount}
            min={1}
            max={MAX_STAT}
            onChange={(amount) => onChange({ ...ability, effect: { ...effect, amount } })}
          />
        )}
        {'count' in effect && (
          <NumberField
            label="Nombre"
            value={effect.count}
            min={1}
            max={MAX_STAT}
            onChange={(count) => onChange({ ...ability, effect: { ...effect, count } })}
          />
        )}
        {effect.type === 'summonToken' && (
          <>
            <NumberField
              label="Attaque"
              value={effect.attack}
              min={0}
              max={MAX_STAT}
              onChange={(attack) => onChange({ ...ability, effect: { ...effect, attack } })}
            />
            <NumberField
              label="Défense"
              value={effect.defense}
              min={1}
              max={MAX_STAT}
              onChange={(defense) => onChange({ ...ability, effect: { ...effect, defense } })}
            />
          </>
        )}
        {effect.type === 'buff' && (
          <>
            <label className="admin-field">
              <span>Cible</span>
              <select
                value={effect.target}
                onChange={(e) =>
                  onChange({ ...ability, effect: { ...effect, target: e.target.value as 'self' | 'otherAllies' } })
                }
              >
                {(['self', 'otherAllies'] as const).map((target) => (
                  <option key={target} value={target}>
                    {BUFF_TARGET_LABELS[target]}
                  </option>
                ))}
              </select>
            </label>
            <NumberField
              label="+ Attaque"
              value={effect.attack}
              min={0}
              max={MAX_STAT}
              onChange={(attack) => onChange({ ...ability, effect: { ...effect, attack } })}
            />
            <NumberField
              label="+ Défense"
              value={effect.defense}
              min={0}
              max={MAX_STAT}
              onChange={(defense) => onChange({ ...ability, effect: { ...effect, defense } })}
            />
          </>
        )}

        <label className="admin-checkbox" title="Ne se déclenche qu'au premier coup éligible de chaque combat">
          <input
            type="checkbox"
            checked={ability.oncePerCombat === true}
            onChange={(e) => {
              const next: CardAbility = { trigger: ability.trigger, effect: ability.effect };
              if (e.target.checked) next.oncePerCombat = true;
              onChange(next);
            }}
          />
          Une seule fois par combat
        </label>
      </div>
    </div>
  );
}

// Puissance de la carte en cours d'édition, avec le détail du calcul. Purement indicatif :
// c'est un repère d'équilibrage pour l'admin, rien n'est stocké et aucune règle ne le lit
// (le barème vit dans `cards.ts`, `cardPower`, réglable dans l'onglet « Paramètres »).
function PowerSummary({ def }: { def: CardDef }) {
  const power = cardPower(def);
  const parts: string[] = [];
  if (isMonster(def)) parts.push(`${def.attack} attaque + ${def.defense} défense`);
  if (power.keywords > 0) parts.push(`habiletés ${power.keywords}`);
  if (power.abilities > 0) parts.push(`capacités ${power.abilities}`);
  if (power.aura > 0) parts.push(`aura ${power.aura}`);
  if (power.enchantment > 0) parts.push(`effet ${power.enchantment}`);

  return (
    <div
      className="admin-power"
      title="Attaque + défense, plus la valeur de chaque habileté, capacité, aura ou effet d’enchantement (onglet Paramètres). Indicatif : aucune règle ne s’en sert."
    >
      <span className="admin-power-label">Puissance</span>
      <span className="admin-power-value">{power.total}</span>
      <span className="admin-power-detail">{parts.length > 0 ? parts.join(' + ') : 'aucun point'}</span>
      <PowerBalanceNote def={def} />
    </div>
  );
}

// Verdict d'équilibrage : la puissance comparée à celle visée pour la rareté et le coût de la
// carte (grille de l'onglet « Paramètres »).
function PowerBalanceNote({ def }: { def: CardDef }) {
  const balance = powerBalance(def);
  if (!balance) {
    return <span className="admin-power-balance">Pas de puissance visée pour un coût de {def.cost}.</span>;
  }
  const { target, gap } = balance;
  const rarity = RARITY_LABELS[cardRarity(def)].toLowerCase();
  const reference = `visée ${target} (${rarity}, ${def.cost} ¤)`;
  if (gap === 0) {
    return <span className="admin-power-balance is-balanced">Équilibrée · {reference}</span>;
  }
  return (
    <span className={`admin-power-balance ${gap > 0 ? 'is-strong' : 'is-weak'}`}>
      {gap > 0 ? `Trop forte de ${gap}` : `Trop faible de ${-gap}`} · {reference}
    </span>
  );
}

interface CardEditorProps {
  version: GameVersion;
  def: CardDef;
  // Exemplaires dans le deck de départ (V1). Absent en V2, où les exemplaires se règlent deck
  // par deck (onglet « Decks ») : le champ n'est alors pas affiché.
  copies?: number;
  onChange: (next: CardDef) => void;
  onCopiesChange?: (count: number) => void;
  onRemove: () => void;
}

function CardEditor({ version, def, copies, onChange, onCopiesChange, onRemove }: CardEditorProps) {
  const parsed = parseCardDef(def, def.name || 'carte', version);
  const abilities = def.abilities ?? [];

  function setAbilities(next: CardAbility[]) {
    const updated = { ...def };
    if (next.length > 0) updated.abilities = next;
    else delete updated.abilities;
    onChange(updated);
  }

  function setKind(kind: CardDef['kind']) {
    if (kind === def.kind) return;
    // On repart d'une carte neuve du bon type en gardant l'identité et le coût : les champs
    // d'un monstre et d'un enchantement n'ont presque rien en commun.
    const fresh = freshCard(kind, def.id);
    onChange({ ...fresh, name: def.name, cost: def.cost, element: def.element, rarity: cardRarity(def) });
  }

  function toggleKeyword(keyword: Keyword, on: boolean) {
    if (!isMonster(def)) return;
    const current = def.keywords ?? [];
    const next = on ? [...current, keyword] : current.filter((k) => k !== keyword);
    const updated: MonsterDef = { ...def };
    if (next.length > 0) updated.keywords = next;
    else delete updated.keywords;
    onChange(updated);
  }

  function setAura(on: boolean) {
    if (!isMonster(def)) return;
    const updated: MonsterDef = { ...def };
    if (on) updated.aura = { attack: 1, defense: 1 };
    else delete updated.aura;
    onChange(updated);
  }

  return (
    <div className="admin-editor">
      <div className="admin-editor-main">
        <div className="admin-row">
          <label className="admin-field">
            <span>Type</span>
            <select value={def.kind} onChange={(e) => setKind(e.target.value as CardDef['kind'])}>
              <option value="monster">Monstre</option>
              <option value="enchantment">Enchantement</option>
            </select>
          </label>

          <label className="admin-field admin-field-wide">
            <span>Nom</span>
            <input value={def.name} maxLength={40} onChange={(e) => onChange({ ...def, name: e.target.value })} />
          </label>

          <label className="admin-field" title="Identifiant technique : il sert de clé pour l'illustration">
            <span>Identifiant</span>
            <input value={def.id} onChange={(e) => onChange({ ...def, id: e.target.value.trim() })} />
          </label>
        </div>

        <div className="admin-row">
          <label className="admin-field">
            <span>Élément</span>
            <select
              value={def.element}
              onChange={(e) => onChange({ ...def, element: e.target.value as CardElement })}
            >
              {elementsFor(version).map((element) => (
                <option key={element} value={element}>
                  {ELEMENT_LABELS[element]}
                </option>
              ))}
            </select>
          </label>

          <label
            className="admin-field"
            title="Indication de valeur affichée sur la carte : elle n’entre dans aucune règle"
          >
            <span>Rareté</span>
            <select
              value={cardRarity(def)}
              onChange={(e) => onChange({ ...def, rarity: e.target.value as CardRarity })}
            >
              {CARD_RARITIES.map((rarity) => (
                <option key={rarity} value={rarity}>
                  {RARITY_LABELS[rarity]}
                </option>
              ))}
            </select>
          </label>

          <NumberField label="Coût" value={def.cost} min={0} max={MAX_COST} onChange={(cost) => onChange({ ...def, cost })} />

          {isMonster(def) && (
            <>
              <NumberField
                label="Attaque"
                value={def.attack}
                min={0}
                max={MAX_STAT}
                onChange={(attack) => onChange({ ...def, attack })}
              />
              <NumberField
                label="Défense"
                value={def.defense}
                min={1}
                max={MAX_STAT}
                onChange={(defense) => onChange({ ...def, defense })}
              />
            </>
          )}

          {copies !== undefined && onCopiesChange && (
            <NumberField
              label="Exemplaires"
              value={copies}
              min={0}
              max={MAX_COPIES}
              onChange={onCopiesChange}
            />
          )}
        </div>

        {isMonster(def) && (
          <>
            <fieldset className="admin-fieldset">
              <legend>Habiletés</legend>
              <div className="admin-keywords">
                {keywordsFor(version).map((keyword) => (
                  <label key={keyword} className="admin-checkbox" title={describeKeywordEffect(keyword)}>
                    <input
                      type="checkbox"
                      checked={def.keywords?.includes(keyword) ?? false}
                      onChange={(e) => toggleKeyword(keyword, e.target.checked)}
                    />
                    {KEYWORD_LABELS[keyword]}
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Les auras n'existent plus en V2 (modifsV2.md). */}
            {version === 'v1' && (
            <fieldset className="admin-fieldset">
              <legend>Aura</legend>
              <label className="admin-checkbox">
                <input type="checkbox" checked={def.aura !== undefined} onChange={(e) => setAura(e.target.checked)} />
                Donne un bonus continu à tes autres monstres
              </label>
              {def.aura && (
                <div className="admin-row">
                  <NumberField
                    label="+ Attaque"
                    value={def.aura.attack}
                    min={0}
                    max={MAX_STAT}
                    onChange={(attack) => onChange({ ...def, aura: { ...def.aura!, attack } })}
                  />
                  <NumberField
                    label="+ Défense"
                    value={def.aura.defense}
                    min={0}
                    max={MAX_STAT}
                    onChange={(defense) => onChange({ ...def, aura: { ...def.aura!, defense } })}
                  />
                </div>
              )}
            </fieldset>
            )}
          </>
        )}

        {!isMonster(def) && (
          <fieldset className="admin-fieldset">
            <legend>Effet de l’enchantement</legend>
            <div className="admin-row">
              <label className="admin-field">
                <span>Effet</span>
                <select
                  value={def.effect.type}
                  onChange={(e) =>
                    onChange({ ...def, effect: freshEnchantmentEffect(e.target.value as EnchantmentEffect['type']) })
                  }
                >
                  {enchantmentEffectTypesFor(version).map((type) => (
                    <option key={type} value={type}>
                      {ENCHANTMENT_EFFECT_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>

              {def.effect.type === 'coinsPerTurn' && (
                <NumberField
                  label="Pièces"
                  value={def.effect.amount}
                  min={1}
                  max={MAX_STAT}
                  onChange={(amount) => onChange({ ...def, effect: { type: 'coinsPerTurn', amount } })}
                />
              )}

              {def.effect.type === 'sellBonus' && (
                <NumberField
                  label="Pièces"
                  value={def.effect.amount}
                  min={1}
                  max={MAX_STAT}
                  onChange={(amount) => onChange({ ...def, effect: { type: 'sellBonus', amount } })}
                />
              )}

              {def.effect.type === 'marketSize' && (
                <NumberField
                  label="Cartes"
                  value={def.effect.count}
                  min={1}
                  max={MAX_STAT}
                  onChange={(count) => onChange({ ...def, effect: { type: 'marketSize', count } })}
                />
              )}

              {def.effect.type === 'monsterBuff' && (
                <>
                  <label className="admin-field">
                    <span>Zone</span>
                    <select
                      value={def.effect.zone}
                      onChange={(e) =>
                        onChange({
                          ...def,
                          effect: { ...def.effect, zone: e.target.value as 'attack' | 'defense' | 'all' } as EnchantmentEffect,
                        })
                      }
                    >
                      {(['attack', 'defense', 'all'] as const).map((zone) => (
                        <option key={zone} value={zone}>
                          {BUFF_ZONE_LABELS[zone]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <NumberField
                    label="+ Attaque"
                    value={def.effect.attack}
                    min={0}
                    max={MAX_STAT}
                    onChange={(attack) => onChange({ ...def, effect: { ...def.effect, attack } as EnchantmentEffect })}
                  />
                  <NumberField
                    label="+ Défense"
                    value={def.effect.defense}
                    min={0}
                    max={MAX_STAT}
                    onChange={(defense) => onChange({ ...def, effect: { ...def.effect, defense } as EnchantmentEffect })}
                  />
                </>
              )}
            </div>
          </fieldset>
        )}

        <fieldset className="admin-fieldset">
          <legend>Capacités</legend>
          {abilities.map((ability, i) => (
            <AbilityRow
              // Pas d'identifiant stable sur une capacité : l'index fait l'affaire, la liste
              // n'est ni triée ni réordonnée.
              key={i}
              ability={ability}
              def={def}
              version={version}
              onChange={(next) => setAbilities(abilities.map((a, j) => (j === i ? next : a)))}
              onRemove={() => setAbilities(abilities.filter((_, j) => j !== i))}
            />
          ))}
          <button
            type="button"
            onClick={() => setAbilities([...abilities, { trigger: 'summon', effect: freshAbilityEffect('gainCoins') }])}
          >
            Ajouter une capacité
          </button>
        </fieldset>

        {!parsed.ok && (
          <ul className="admin-errors">
            {parsed.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}

        <button type="button" className="admin-remove" onClick={onRemove}>
          Supprimer cette carte
        </button>
      </div>

      <div className="admin-editor-side">
        <CardPreview def={def} />
        <PowerSummary def={def} />
      </div>
    </div>
  );
}

export default CardEditor;
