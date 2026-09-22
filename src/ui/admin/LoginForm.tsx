import { useState } from 'react';
import { signIn } from '../../net/auth';

interface LoginFormProps {
  onSignedIn: () => void;
}

function LoginForm({ onSignedIn }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="menu" onSubmit={handleSubmit}>
      <h1>Administration</h1>
      <p className="admin-summary">Réservé au compte administrateur du projet Firebase.</p>

      <label>
        E-mail
        <input
          type="email"
          value={email}
          autoComplete="username"
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>

      <label>
        Mot de passe
        <input
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>

      <button type="submit" disabled={busy || !email || !password}>
        {busy ? 'Connexion…' : 'Se connecter'}
      </button>

      {error && <p className="error">{error}</p>}
    </form>
  );
}

export default LoginForm;
