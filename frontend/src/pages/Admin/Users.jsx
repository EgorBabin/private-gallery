import { useEffect, useState } from 'react'
import styles from './Users.module.css'
import { useTitle } from '@/hooks/useTitle'
import { useWarnOnUnload } from '@/hooks/useWarnOnUnload'
import { useVibration } from '@/hooks/useVibration'

export default function UsersPage() {
    useTitle('Пользователи')
    const vibrate = useVibration()

    const [users, setUsers] = useState([])
    const [form, setForm] = useState({ username: '', email: '', phone: '', role: 'user' })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    // флаг несохранённые изменения для хука
    const [isDirty, setIsDirty] = useState(false)
    // подключаем предупреждение при закрытии вкладки
    useWarnOnUnload(isDirty)

    // Получение списка пользователей
    async function fetchUsers() {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch('/api/users')
            if (!res.ok) throw new Error('Ошибка загрузки', vibrate('false'))
            const data = await res.json()
            setUsers(data)
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchUsers()
    }, [])

    // Обработка формы
    function handleChange(e) {
        setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
        setIsDirty(true)
    }

    async function handleAdd(e) {
        e.preventDefault()
        setError(null)
        try {
            const res = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || 'Ошибка создания пользователя', vibrate('false'))
            }

            setUsers(prev => [...prev, data])
            setForm({ username: '', email: '', phone: '', role: 'user' })

            setIsDirty(false) // сбрасываем грязь, после сохранения
        } catch (e) {
            vibrate('warn')
            setError(e.message)
        }
    }

    // Удаление пользователя
    async function handleDelete(id) {
        if (!window.confirm('Удалить пользователя?')) return
        try {
            const res = await fetch(`/api/users/${id}`, {
                method: 'DELETE',
            })
            if (!res.ok) throw new Error('Ошибка удаления', vibrate('false'))
            setUsers(prev => prev.filter(u => u.id !== id))
        } catch (e) {
            vibrate('false')
            setError(e.message)
        }
    }

    // Обновление пользователя (например, изменить роль)
    async function handleUpdate(id, updatedFields) {
        try {
            const res = await fetch(`/api/users/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedFields),
            })
            if (!res.ok) throw new Error('Ошибка обновления', vibrate('false'))
            const updatedUser = await res.json()
            setUsers(prev => prev.map(u => (u.id === id ? updatedUser : u)))
        } catch (e) {
            vibrate('false')
            setError(e.message)
        }
    }

    return (
        <div>
            <h1>Пользователи</h1>

            {loading ? (
                <p>Загрузка...</p>
            ) : (
                <div className={styles.tableWrap}>
                    <table border="1" cellPadding="5" style={{ borderCollapse: 'collapse' }}>
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
                                    onChange={e => handleUpdate(id, { username: e.target.value })}
                                    placeholder="Username"
                                />
                            </td>
                            <td>
                                <input
                                    type="text"
                                    value={email.join(', ')}
                                    onChange={e =>
                                        handleUpdate(id, { email: e.target.value.split(',').map(s => s.trim()) })
                                    }
                                    placeholder="Email1, Email2"
                                />
                            </td>
                            <td>
                                <input
                                    type="text"
                                    value={phone || ''}
                                    onChange={e =>
                                        handleUpdate(id, { phone: e.target.value })
                                    }
                                    placeholder="Телефон"
                                />
                            </td>
                            <td>
                                <select
                                    value={role}
                                    onChange={e => handleUpdate(id, { role: e.target.value })}
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
                        onChange={e =>
                            setForm(prev => ({ ...prev, email: e.target.value.split(',').map(s => s.trim()) }))
                        }
                        // required
                    />
                    <input
                        inputMode="tel"
                        name="phone"
                        placeholder="Телефон"
                        value={form.phone}
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
    )
}
