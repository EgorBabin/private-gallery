import { useCallback, useEffect, useState } from 'react';
import styles from './Users.module.css';
import { useTitle } from '@/hooks/useTitle';
import { useCsrfFetch } from '@/hooks/useCsrfFetch';
import { useWarnOnUnload } from '@/hooks/useWarnOnUnload';
import { useVibration } from '@/hooks/useVibration';
import { parseApiResponse } from '@/utils/apiResponse';
import { notify, notifyError } from '@/utils/notifications';

export default function UsersPage() {
  useTitle('Пользователи');
  const csrfFetch = useCsrfFetch();
  const vibrate = useVibration();

  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({
    username: '',
    email: '',
    telegramID: '',
    role: 'user',
  });
  const [loading, setLoading] = useState(false);

  // флаг несохранённые изменения для хука
  const [isDirty, setIsDirty] = useState(false);
  // подключаем предупреждение при закрытии вкладки
  useWarnOnUnload(isDirty);

  // Получение списка пользователей
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await csrfFetch('/api/users');
      const { data } = await parseApiResponse(
        res,
        'Не удалось загрузить пользователей',
      );

      const usersList = Array.isArray(data?.users)
        ? data.users
        : Array.isArray(data)
          ? data
          : [];
      setUsers(usersList);
    } catch (e) {
      vibrate('false');
      notifyError(e, 'Не удалось загрузить пользователей');
    } finally {
      setLoading(false);
    }
  }, [csrfFetch, vibrate]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Обработка формы
  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setIsDirty(true);
  }

  async function handleAdd(e) {
    e.preventDefault();
    try {
      const res = await csrfFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const { data, message, status } = await parseApiResponse(
        res,
        'Не удалось создать пользователя',
      );
      const createdUser = data?.user || data;

      setUsers((prev) => [...prev, createdUser]);
      setForm({ username: '', email: '', telegramID: '', role: 'user' });
      notify({
        status,
        message:
          message ||
          `Пользователь ${createdUser?.username || form.username} создан`,
      });

      setIsDirty(false); // сбрасываем грязь, после сохранения
    } catch (e) {
      vibrate('warn');
      notifyError(e, 'Не удалось создать пользователя');
    }
  }

  // Удаление пользователя
  async function handleDelete(id) {
    if (!window.confirm('Удалить пользователя?')) return;
    try {
      const res = await csrfFetch(`/api/users/${id}`, {
        method: 'DELETE',
      });

      const { message, status } = await parseApiResponse(
        res,
        'Не удалось удалить пользователя',
      );
      setUsers((prev) => prev.filter((u) => u.id !== id));
      notify({ status, message: message || 'Пользователь удалён' });
    } catch (e) {
      vibrate('false');
      notifyError(e, 'Не удалось удалить пользователя');
    }
  }

  // Обновление пользователя (например, изменить роль)
  async function handleUpdate(id, updatedFields) {
    try {
      const res = await csrfFetch(`/api/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedFields),
      });

      const { data } = await parseApiResponse(
        res,
        'Не удалось обновить пользователя',
      );
      const updatedUser = data?.user || data;
      setUsers((prev) => prev.map((u) => (u.id === id ? updatedUser : u)));
    } catch (e) {
      vibrate('false');
      notifyError(e, 'Не удалось обновить пользователя');
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
                <th>tgID</th>
                <th>Роль</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.map(({ id, username, email, telegramID, role }) => (
                <tr key={id}>
                  <td>{id}</td>
                  <td>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) =>
                        handleUpdate(id, {
                          username: e.target.value,
                        })
                      }
                      placeholder="Username"
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
                      placeholder="Email"
                    />
                  </td>
                  <td>
                    <input
                      type="tel"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={telegramID || ''}
                      onChange={(e) =>
                        handleUpdate(id, {
                          telegramID: e.target.value,
                        })
                      }
                      placeholder="Телеграм ID"
                    />
                  </td>
                  <td>
                    <select
                      value={role}
                      onChange={(e) =>
                        handleUpdate(id, {
                          role: e.target.value,
                        })
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
      <h2>Добавить пользователя</h2>
      <div className={styles.formWrap}>
        <form onSubmit={handleAdd}>
          <input
            inputMode="text"
            name="username"
            placeholder="Username"
            value={form.username}
            onChange={handleChange}
            // required
          />
          <input
            inputMode="email"
            name="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                email: e.target.value.split(',').map((s) => s.trim()),
              }))
            }
            // required
          />
          <input
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            name="telegramID"
            placeholder="Телеграм ID"
            value={form.telegramID}
            onChange={handleChange}
            // required
          />
          <select name="role" value={form.role} onChange={handleChange}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          <button type="submit">Добавить</button>
        </form>
      </div>
    </div>
  );
}
