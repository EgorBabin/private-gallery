import { useState } from 'react';
import base64url from 'base64url';
import { useCsrfFetch } from '@/hooks/useCsrfFetch';
import { useVibration } from '@/hooks/useVibration';

export default function WebAuthnAuth() {
  const csrfFetch = useCsrfFetch();
  const vibrate = useVibration();
  const [username, setUsername] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [error, setError] = useState(null);
  const [loggedIn, setLoggedIn] = useState(false);

  async function register() {
    try {
      if (!inviteToken) throw new Error('Введите invite token');

      const res = await csrfFetch('/api/webauthn/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, inviteSessionToken: inviteToken }),
      });
      if (!res.ok) throw new Error('Не удалось получить options');

      const options = await res.json();
      const publicKey = {
        ...options,
        challenge: base64url.toBuffer(options.challenge),
        user: { ...options.user, id: base64url.toBuffer(options.user.id) },
      };

      const credential = await navigator.credentials.create({ publicKey });

      const verifyRes = await csrfFetch('/api/webauthn/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          attestationResponse: credential,
          inviteSessionToken: inviteToken,
        }),
      });

      if (!verifyRes.ok) throw new Error('Регистрация не удалась');
      setLoggedIn(true);
    } catch (e) {
      vibrate('warn');
      setError(e.message);
    }
  }

  async function login() {
    try {
      const res = await csrfFetch('/api/webauthn/login/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      if (!res.ok) throw new Error('Не удалось получить challenge');

      const options = await res.json();
      const publicKey = {
        ...options,
        challenge: base64url.toBuffer(options.challenge),
        allowCredentials: options.allowCredentials.map((cred) => ({
          ...cred,
          id: base64url.toBuffer(cred.id),
        })),
      };

      const assertion = await navigator.credentials.get({ publicKey });

      const verifyRes = await csrfFetch('/api/webauthn/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, assertionResponse: assertion }),
      });

      if (!verifyRes.ok) throw new Error('Вход не удался');
      setLoggedIn(true);
    } catch (e) {
      vibrate('warn');
      setError(e.message);
    }
  }

  return (
    <div>
      <h1>Регистрация / Вход через Passkey</h1>
      <input
        type="text"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        type="text"
        placeholder="Invite Token"
        value={inviteToken}
        onChange={(e) => setInviteToken(e.target.value)}
      />
      <div>
        <button onClick={register}>Зарегистрироваться</button>
        <button onClick={login}>Войти</button>
      </div>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loggedIn && <p>Вы вошли в систему!</p>}
    </div>
  );
}
