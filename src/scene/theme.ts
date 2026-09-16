// Couleurs et dimensions du plateau et des cartes, centralisées ici (aucune couleur
// en dur ailleurs dans la scène 3D).
export const theme = {
  colors: {
    tableTop: '#1c1f26',
    tableTopBright: '#30343f',
    cardBack: '#2a2e38',
    discardPile: '#3a2426',
    heroMine: '#4f8cff',
    heroOpponent: '#ff5c5c',
    haloPlayable: '#4fd67a',
    haloSelected: '#f5c344',
    haloTarget: '#ff5c5c',
    attackBadge: '#b8341f',
    defenseBadge: '#3e6be8',
    statBuffed: '#4fd67a',
    statWounded: '#ff5c5c',
    parchment: '#e8d4a8',
    parchmentLight: '#f8eed6',
    inkOnParchment: '#2b1d10',
    gold: '#d4a82a',
    goldLight: '#fff1a8',
    goldDark: '#7a5a0c',
    zoneAttack: '#5a2a2a',
    zoneDefense: '#26385a',
    zoneEnchant: '#3a2a5a',
    zoneOutline: 'rgba(255, 255, 255, 0.18)',
    zoneAttackBright: '#8a4444',
    zoneDefenseBright: '#3a5a8f',
    zoneEnchantBright: '#5c3f96',
    zoneOutlineBright: 'rgba(255, 255, 255, 0.4)',
  },
  // Couleurs des faces selon l'élément de la carte : `light`→`base` en dégradé de fond,
  // `badge`/`icon` pour la pastille du logo d'élément.
  elements: {
    fire: { light: '#f29a6b', base: '#d2553a', badge: '#7d2412', icon: '#ffd27a' },
    water: { light: '#8cc4f0', base: '#3f86cc', badge: '#163f73', icon: '#dff1ff' },
    air: { light: '#dff2ea', base: '#9ccbbd', badge: '#2f6c61', icon: '#f2fffb' },
    earth: { light: '#c9a877', base: '#96723f', badge: '#4a3416', icon: '#f0dcb0' },
  },
  // Illustrations des cartes (cardArt.ts) : décor et silhouettes selon l'élément.
  art: {
    fire: {
      skyTop: '#ffd08a', skyBottom: '#e0613a', sun: '#fff4c2', hills: 'rgba(110, 30, 20, 0.45)',
      ground: '#5a1d14', ink: '#2a0f0b', light: '#ffe6b0', accent: '#ffb347',
    },
    water: {
      skyTop: '#d4f1ff', skyBottom: '#4a9ad8', sun: '#ffffff', hills: 'rgba(20, 60, 110, 0.4)',
      ground: '#173a66', ink: '#0d1e36', light: '#e6f6ff', accent: '#7fd3ff',
    },
    air: {
      skyTop: '#ffffff', skyBottom: '#a9dcd0', sun: '#fffbe0', hills: 'rgba(60, 120, 110, 0.35)',
      ground: '#4f8a7c', ink: '#1b3a35', light: '#ffffff', accent: '#ffe36b',
    },
    earth: {
      skyTop: '#fbe3ad', skyBottom: '#c98f4f', sun: '#fff6d8', hills: 'rgba(90, 60, 30, 0.45)',
      ground: '#4e3218', ink: '#24170b', light: '#fbe9c4', accent: '#8fd46a',
    },
  },
  card: {
    width: 1.2,
    height: 1.68, // ratio 5:7
  },
};
