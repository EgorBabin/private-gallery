import { useEffect, useState } from 'react'
import { useTitle } from '@/hooks/useTitle'

export default function UsersPage() {
    useTitle('Пользователи')
    const [users, setUsers] = useState([])
    const [form, setForm] = useState({ username: '', email: '', phone: '', role: 'user' })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    // Получение списка пользователей
    async function fetchUsers() {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch('http://localhost:3000/api/users')
            if (!res.ok) throw new Error('Ошибка загрузки')
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
    }

    async function handleAdd(e) {
        e.preventDefault()
        setError(null)
        try {
            const res = await fetch('http://localhost:3000/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || 'Ошибка создания пользователя')
            }

            setUsers(prev => [...prev, data])
            setForm({ username: '', email: '', phone: '', role: 'user' })
        } catch (e) {
            setError(e.message)
        }
    }

    // Удаление пользователя
    async function handleDelete(id) {
        if (!window.confirm('Удалить пользователя?')) return
        try {
            const res = await fetch(`http://localhost:3000/api/users/${id}`, {
                method: 'DELETE',
            })
            if (!res.ok) throw new Error('Ошибка удаления')
            setUsers(prev => prev.filter(u => u.id !== id))
        } catch (e) {
            setError(e.message)
        }
    }

    // Обновление пользователя (например, изменить роль)
    async function handleUpdate(id, updatedFields) {
        try {
            const res = await fetch(`http://localhost:3000/api/users/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedFields),
            })
            if (!res.ok) throw new Error('Ошибка обновления')
            const updatedUser = await res.json()
            setUsers(prev => prev.map(u => (u.id === id ? updatedUser : u)))
        } catch (e) {
            setError(e.message)
        }
    }

    return (
        <div>
        <h1>Пользователи</h1>

        {error && <div style={{ color: 'red' }}>{error}</div>}
        {loading ? (
            <p>Загрузка...</p>
        ) : (
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
        )}

        <h2>Добавить пользователя</h2>
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
    )
}
