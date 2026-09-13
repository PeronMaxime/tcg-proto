const PLAYER_ID_KEY = 'tcg-player-id';
const PLAYER_NAME_KEY = 'tcg-player-name';

// Un id par onglet (sessionStorage) : deux onglets = deux joueurs, ce qui rend les tests triviaux.
export function getPlayerId(): string {
  let id = sessionStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

export function getPlayerName(): string {
  return localStorage.getItem(PLAYER_NAME_KEY) ?? '';
}

export function setPlayerName(name: string): void {
  localStorage.setItem(PLAYER_NAME_KEY, name);
}
