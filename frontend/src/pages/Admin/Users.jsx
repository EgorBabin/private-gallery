import { useEffect, useState } from 'react';
import styles from './Users.module.css';
import { useTitle } from '@/hooks/useTitle';
import { useCsrfFetch } from '@/hooks/useCsrfFetch';
import { useWarnOnUnload } from '@/hooks/useWarnOnUnload';
import { useVibration } from '@/hooks/useVibration';

export default function UsersPage() {
  useTitle('Пользователи');
  const csrfFetch = useCsrfFetch();
  const vibrate = useVibration();

  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({
    username: '',
    email: '',
    phone: '',
    role: 'user',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [inviteCode, setInviteCode] = useState(null);

  const [isDirty, setIsDirty] = useState(false);
  useWarnOnUnload(isDirty);

  async function fetchUsers() {
    setLoading(true);
    setError(null);
    try {
      const res = await csrfFetch('/api/users');
      if (!res.ok) throw new Error('Ошибка загрузки');
      const data = await res.json();
      setUsers(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchUsers();
  }, []);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setIsDirty(true);
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError(null);
    try {
      const res = await csrfFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || 'Ошибка создания пользователя');
      setUsers((prev) => [...prev, data]);
      setForm({ username: '', email: '', phone: '', role: 'user' });
      setIsDirty(false);
    } catch (e) {
      vibrate('warn');
      setError(e.message);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Удалить пользователя?')) return;
    try {
      const res = await csrfFetch(`/api/users/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Ошибка удаления');
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleUpdate(id, updatedFields) {
    try {
      const res = await csrfFetch(`/api/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedFields),
      });
      if (!res.ok) throw new Error('Ошибка обновления');
      const updatedUser = await res.json();
      setUsers((prev) => prev.map((u) => (u.id === id ? updatedUser : u)));
    } catch (e) {
      setError(e.message);
    }
  }

  async function createInvite() {
    try {
      const res = await csrfFetch('/api/invites', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка создания кода');
      setInviteCode(data.code);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1>Пользователи</h1>
      {loading ? (
        <p>Загрузка...</p>
      ) : (
        <div className={styles.tableWrap}>
          <table
            border="1"
            cellPadding="5"
            style={{ borderCollapse: 'collapse' }}
          >
            <thead>
              <tr>
                <th>ID</th>
                <th>Имя</th>
                <th>Email</th>
                <th>Телефон</th>
                <th>Роль</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.map(({ id, username, email, phone, role }) => (
                <tr key={id}>
                  <td>{id}</td>
                  <td>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) =>
                        handleUpdate(id, { username: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={email.join(', ')}
                      onChange={(e) =>
                        handleUpdate(id, {
                          email: e.target.value.split(',').map((s) => s.trim()),
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={phone || ''}
                      onChange={(e) =>
                        handleUpdate(id, { phone: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <select
                      value={role}
                      onChange={(e) =>
                        handleUpdate(id, { role: e.target.value })
                      }
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>
                    <button onClick={() => handleDelete(id)}>Удалить</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <div style={{ color: 'red' }}>{error}</div>}

      <h2>Добавить пользователя</h2>
      <form onSubmit={handleAdd} className={styles.formWrap}>
        <input
          name="username"
          placeholder="Username"
          value={form.username}
          onChange={handleChange}
        />
        <input
          name="email"
          placeholder="Email"
          value={form.email}
          onChange={(e) =>
            setForm((prev) => ({
              ...prev,
              email: e.target.value.split(',').map((s) => s.trim()),
            }))
          }
        />
        <input
          name="phone"
          placeholder="Телефон"
          value={form.phone}
          onChange={handleChange}
        />
        <select name="role" value={form.role} onChange={handleChange}>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        <button type="submit">Добавить</button>
      </form>

      <h2>Создать пригласительный код</h2>
      <button onClick={createInvite}>Создать код</button>
      {inviteCode && <p>Код: {inviteCode}</p>}
      <h2>&shy;</h2>
    </div>
  );
}
