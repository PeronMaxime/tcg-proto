import { ELEMENT_BEATS, ELEMENT_LABELS } from '../game/cards';
import type { CardElement } from '../game/types';
import { theme } from '../scene/theme';

// Petite roue des affinités élémentaires (demande utilisateur), affichée à gauche du HUD :
// chaque flèche va d'un élément vers celui qu'il domine. L'ordre est dérivé de
// `ELEMENT_BEATS`, donc la roue suit automatiquement un changement de règles.

const SIZE = 160;
const CENTER = 80;
const RADIUS = 46;
const NODE_RADIUS = 15;
// Écart angulaire (degrés) entre le centre d'un élément et le début/fin d'une flèche.
const ARROW_GAP = 26;
// Noms des éléments posés à l'extérieur de la roue, pour ne pas croiser les flèches.
const LABEL_RADIUS = RADIUS + NODE_RADIUS + 10;

// Icônes dans une grille 24 × 24.
const ICONS: Record<CardElement, { d: string; stroke?: true }> = {
  fire: { d: 'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 2 3 3 3 0-3-1-5 0-8z' },
  water: { d: 'M12 2C9 7 5 11 5 15a7 7 0 0 0 14 0c0-4-4-8-7-13z' },
  earth: { d: 'M2 20L9 7l4 6 3-4 6 11z' },
  air: { d: 'M3 9h11a3 3 0 1 0-3-3M3 13h16M3 17h9a3 3 0 1 1-3 3', stroke: true },
};

function wheelOrder(): CardElement[] {
  const order: CardElement[] = ['water'];
  while (order.length < Object.keys(ELEMENT_BEATS).length) {
    order.push(ELEMENT_BEATS[order[order.length - 1]]);
  }
  return order;
}

function pointAt(angleDeg: number, radius = RADIUS): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [CENTER + Math.cos(a) * radius, CENTER + Math.sin(a) * radius];
}

function ElementWheel() {
  const order = wheelOrder();
  const step = 360 / order.length;
  const angleOf = (index: number) => -90 + index * step; // premier élément en haut, sens horaire
  const summary = order.map((e) => `${ELEMENT_LABELS[e]} > ${ELEMENT_LABELS[ELEMENT_BEATS[e]]}`).join(', ');

  return (
    <div className="element-wheel" title={`${summary} : +1 dégât contre l'élément dominé`}>
      <span className="element-wheel-title">Affinités</span>
      <svg viewBox={`-26 -2 ${SIZE + 52} ${SIZE + 4}`} role="img" aria-label={`Roue des éléments : ${summary}`}>
        <defs>
          <marker id="element-wheel-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0L10 5L0 10z" fill="var(--hud-gold-bright)" />
          </marker>
        </defs>

        {order.map((element, i) => {
          const [x1, y1] = pointAt(angleOf(i) + ARROW_GAP);
          const [x2, y2] = pointAt(angleOf(i + 1) - ARROW_GAP);
          return (
            <path
              key={`arrow-${element}`}
              d={`M${x1} ${y1}A${RADIUS} ${RADIUS} 0 0 1 ${x2} ${y2}`}
              fill="none"
              stroke="var(--hud-gold)"
              strokeWidth="2.5"
              markerEnd="url(#element-wheel-arrow)"
            />
          );
        })}

        {order.map((element, i) => {
          const [x, y] = pointAt(angleOf(i));
          const palette = theme.elements[element];
          const icon = ICONS[element];
          const [labelX, labelY] = pointAt(angleOf(i), LABEL_RADIUS);
          return (
            <g key={element}>
              <circle cx={x} cy={y} r={NODE_RADIUS} fill={palette.badge} stroke="var(--hud-gold)" strokeWidth="2" />
              <path
                d={icon.d}
                transform={`translate(${x} ${y}) scale(0.75) translate(-12 -12)`}
                fill={icon.stroke ? 'none' : palette.icon}
                stroke={icon.stroke ? palette.icon : 'none'}
                strokeWidth={icon.stroke ? 2.5 : 0}
                strokeLinecap="round"
              />
              <text
                x={labelX}
                y={labelY}
                textAnchor={Math.abs(labelX - CENTER) < 1 ? 'middle' : labelX > CENTER ? 'start' : 'end'}
                dominantBaseline="middle"
                className="element-wheel-label"
              >
                {ELEMENT_LABELS[element]}
              </text>
            </g>
          );
        })}
      </svg>
      <span className="element-wheel-caption">+1 dégât sur l'élément suivant</span>
    </div>
  );
}

export default ElementWheel;
