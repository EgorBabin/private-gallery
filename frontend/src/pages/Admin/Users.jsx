import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './Admin.module.css';
import AdminNav from './AdminNav';
import { useTitle } from '@/hooks/useTitle';
import { useCsrfFetch } from '@/hooks/useCsrfFetch';
import { useCheckSession } from '@/hooks/useCheckSession';
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard';
import { useVibration } from '@/hooks/useVibration';
import { parseApiResponse } from '@/utils/apiResponse';
import { notify, notifyError } from '@/utils/notifications';

// Правки копятся в черновике и уходят на сервер только по кнопке
// «Сохранить», поэтому сервер не проверяет недописанные значения.

const EMPTY_FORM = {
  username: '',
  emailText: '',
  telegramID: '',
  role: 'user',
};

function splitEmails(text) {
  return String(text || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toDraft(user) {
  return {
    username: user.username || '',
    emailText: (user.email || []).join(', '),
    telegramID: user.telegramID || '',
    role: user.role || 'user',
    isActive: user.is_active !== false,
  };
}

/** Поля, отличающиеся от сохранённых, в формате тела PUT /api/users/:id. */
function buildPatch(user, draft) {
  const original = toDraft(user);
  const patch = {};
  if (draft.username.trim() !== original.username) {
    patch.username = draft.username.trim();
  }
  const emails = splitEmails(draft.emailText);
  if (emails.join(',') !== splitEmails(original.emailText).join(',')) {
    patch.email = emails;
  }
  if (draft.telegramID.trim() !== original.telegramID) {
    patch.telegramID = draft.telegramID.trim() || null;
  }
  if (draft.role !== original.role) {
    patch.role = draft.role;
  }
  if (draft.isActive !== original.isActive) {
    patch.is_active = draft.isActive;
  }
  return patch;
}

export default function UsersPage() {
  useTitle('Пользователи');
  const csrfFetch = useCsrfFetch();
  const vibrate = useVibration();
  const { user: currentUser } = useCheckSession();

  const [users, setUsers] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [adding, setAdding] = useState(false);

  const patches = useMemo(() => {
    const result = {};
    for (const user of users) {
      const draft = drafts[user.id];
      if (!draft) continue;
      const patch = buildPatch(user, draft);
      if (Object.keys(patch).length > 0) result[user.id] = patch;
    }
    return result;
  }, [users, drafts]);
  const dirtyCount = Object.keys(patches).length;
  const formDirty = Object.entries(form).some(
    ([key, value]) => value !== EMPTY_FORM[key],
  );

  useUnsavedGuard(dirtyCount > 0 || formDirty);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await csrfFetch('/api/users');
      const { data } = await parseApiResponse(
        res,
        'Не удалось загрузить пользователей',
      );
      setUsers(Array.isArray(data?.users) ? data.users : []);
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

  const updateDraft = (user, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [user.id]: { ...(prev[user.id] || toDraft(user)), [field]: value },
    }));
  };

  const handleSave = async () => {
    const entries = Object.entries(patches);
    if (entries.length === 0 || saving) return;
    setSaving(true);

    const errors = {};
    let saved = 0;
    for (const [id, patch] of entries) {
      try {
        const res = await csrfFetch(`/api/users/${id}`, {
          method: 'PUT',
          body: JSON.stringify(patch),
        });
        const { data } = await parseApiResponse(
          res,
          'Не удалось обновить пользователя',
        );
        const updated = data?.user;
        setUsers((prev) =>
          prev.map((u) => (String(u.id) === id && updated ? updated : u)),
        );
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        saved += 1;
      } catch (e) {
        errors[id] = e?.message || 'Не удалось сохранить';
      }
    }

    setRowErrors(errors);
    setSaving(false);
    const failed = Object.keys(errors).length;
    if (failed === 0) {
      vibrate('click');
      notify({
        status: 'success',
        title: 'Сохранено',
        message:
          saved === 1
            ? 'Изменения пользователя сохранены'
            : `Сохранено пользователей: ${saved}`,
      });
    } else {
      vibrate('warn');
      notify({
        status: 'warning',
        title: 'Сохранено не всё',
        message: `Сохранено: ${saved}, с ошибками: ${failed}. Причина указана у пользователя.`,
      });
    }
  };

  const handleDiscard = () => {
    setDrafts({});
    setRowErrors({});
  };

  async function handleDelete(user) {
    if (!window.confirm(`Удалить пользователя ${user.username}?`)) return;
    try {
      const res = await csrfFetch(`/api/users/${user.id}`, {
        method: 'DELETE',
      });
      const { message, status } = await parseApiResponse(
        res,
        'Не удалось удалить пользователя',
      );
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[user.id];
        return next;
      });
      notify({ status, message: message || 'Пользователь удалён' });
    } catch (e) {
      vibrate('false');
      notifyError(e, 'Не удалось удалить пользователя');
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (adding) return;
    setAdding(true);
    try {
      const res = await csrfFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          username: form.username.trim(),
          email: splitEmails(form.emailText),
          telegramID: form.telegramID.trim(),
          role: form.role,
        }),
      });
      const { data, message, status } = await parseApiResponse(
        res,
        'Не удалось создать пользователя',
      );
      if (data?.user) setUsers((prev) => [...prev, data.user]);
      setForm(EMPTY_FORM);
      notify({
        status,
        message: message || `Пользователь ${form.username} создан`,
      });
    } catch (err) {
      vibrate('warn');
      notifyError(err, 'Не удалось создать пользователя');
    } finally {
      setAdding(false);
    }
  }

  const fieldClass = (patch, key) =>
    patch && key in patch
      ? `${styles.field} ${styles.fieldChanged}`
      : styles.field;

  return (
    <div className={styles.page}>
      <AdminNav />
      <h1 className={styles.title}>Пользователи</h1>

      <div
        className={`${styles.saveBar} ${dirtyCount > 0 ? styles.saveBarDirty : ''}`}
      >
        <span className={styles.saveBarText}>
          {saving
            ? 'Сохраняем…'
            : dirtyCount > 0
              ? `Несохранённые изменения: ${dirtyCount}`
              : 'Все изменения сохранены'}
        </span>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            onClick={handleDiscard}
            disabled={dirtyCount === 0 || saving}
          >
            Отменить
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={handleSave}
            disabled={dirtyCount === 0 || saving}
          >
            Сохранить
          </button>
        </div>
      </div>

      {loading ? (
        <p className={styles.empty}>Загрузка…</p>
      ) : (
        <div className={styles.cards}>
          {users.map((user) => {
            const draft = drafts[user.id] || toDraft(user);
            const patch = patches[user.id];
            const error = rowErrors[user.id];
            const isSelf = Number(currentUser?.id) === Number(user.id);
            const cardClass = [
              styles.card,
              patch ? styles.cardDirty : '',
              error ? styles.cardError : '',
              !draft.isActive ? styles.cardInactive : '',
            ].join(' ');

            return (
              <div key={user.id} className={cardClass}>
                <div className={styles.cardHead}>
                  <span className={styles.cardName}>
                    #{user.id} {user.username}
                  </span>
                  <div className={styles.badges}>
                    {isSelf && (
                      <span className={`${styles.badge} ${styles.badgeAccent}`}>
                        это вы
                      </span>
                    )}
                    {patch && (
                      <span className={`${styles.badge} ${styles.badgeWarn}`}>
                        изменён
                      </span>
                    )}
                  </div>
                </div>

                <label className={fieldClass(patch, 'username')}>
                  Имя
                  <input
                    className={styles.input}
                    value={draft.username}
                    onChange={(e) =>
                      updateDraft(user, 'username', e.target.value)
                    }
                  />
                </label>
                <label className={fieldClass(patch, 'email')}>
                  Email (через запятую: Google, Яндекс)
                  <input
                    className={styles.input}
                    inputMode="email"
                    value={draft.emailText}
                    onChange={(e) =>
                      updateDraft(user, 'emailText', e.target.value)
                    }
                  />
                </label>
                <label className={fieldClass(patch, 'telegramID')}>
                  Telegram ID
                  <input
                    className={styles.input}
                    inputMode="numeric"
                    value={draft.telegramID}
                    onChange={(e) =>
                      updateDraft(user, 'telegramID', e.target.value)
                    }
                  />
                </label>
                <label className={fieldClass(patch, 'role')}>
                  Роль
                  <select
                    className={styles.select}
                    value={draft.role}
                    disabled={isSelf}
                    onChange={(e) => updateDraft(user, 'role', e.target.value)}
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </label>
                <label className={fieldClass(patch, 'is_active')}>
                  Доступ
                  <select
                    className={styles.select}
                    value={draft.isActive ? 'on' : 'off'}
                    disabled={isSelf}
                    onChange={(e) =>
                      updateDraft(user, 'isActive', e.target.value === 'on')
                    }
                  >
                    <option value="on">может входить</option>
                    <option value="off">отключён</option>
                  </select>
                </label>

                {error && <div className={styles.errorText}>{error}</div>}

                {!isSelf && (
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={`${styles.button} ${styles.buttonDanger}`}
                      onClick={() => handleDelete(user)}
                    >
                      Удалить
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Добавить пользователя</h2>
        <form className={styles.addForm} onSubmit={handleAdd}>
          <label className={styles.field}>
            Имя
            <input
              className={styles.input}
              value={form.username}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, username: e.target.value }))
              }
            />
          </label>
          <label className={styles.field}>
            Email (через запятую)
            <input
              className={styles.input}
              inputMode="email"
              value={form.emailText}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, emailText: e.target.value }))
              }
            />
          </label>
          <label className={styles.field}>
            Telegram ID
            <input
              className={styles.input}
              inputMode="numeric"
              value={form.telegramID}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, telegramID: e.target.value }))
              }
            />
          </label>
          <label className={styles.field}>
            Роль
            <select
              className={styles.select}
              value={form.role}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, role: e.target.value }))
              }
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button
            type="submit"
            className={`${styles.button} ${styles.buttonPrimary}`}
            disabled={adding || !formDirty}
          >
            {adding ? 'Добавляем…' : 'Добавить'}
          </button>
        </form>
      </section>
    </div>
  );
}
