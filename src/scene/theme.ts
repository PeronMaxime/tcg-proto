// Couleurs et dimensions du plateau et des cartes, centralisées ici (aucune couleur
// en dur ailleurs dans la scène 3D).
export const theme = {
  colors: {
    tableTop: '#1c1f26',
    cardBack: '#2a2e38',
    cardBackAccent: '#4f8cff',
    heroMine: '#4f8cff',
    heroOpponent: '#ff5c5c',
    haloPlayable: '#4fd67a',
    haloSelected: '#f5c344',
    haloTarget: '#ff5c5c',
    textOnCard: '#0f1115',
    coinBadge: '#c9a441',
    attackBadge: '#c9a441',
    defenseBadge: '#3e6be8',
    statBuffed: '#4fd67a',
    statWounded: '#ff5c5c',
    enchantBand: '#8f3ee8',
    zoneAttack: '#5a2a2a',
    zoneDefense: '#26385a',
    zoneEnchant: '#3a2a5a',
    zoneOutline: 'rgba(255, 255, 255, 0.18)',
  },
  card: {
    width: 1.2,
    height: 1.68, // ratio 5:7
  },
};
