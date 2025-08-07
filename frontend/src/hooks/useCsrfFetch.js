import { useCallback } from 'react'

export function useCsrfFetch() {
    const getCsrfToken = () => {
        const match = document.cookie
        .split('; ')
        .find(row => row.startsWith('_csrf='))
        return match ? match.split('=')[1] : ''
    }

    const csrfFetch = useCallback(async (url, options = {}) => {
        const method = (options.method || 'GET').toUpperCase()
        const token = getCsrfToken()
        const headers = {
        ...(options.headers || {}),
        // для всех опасных запросов добавляем токен
        ...(method !== 'GET' && method !== 'HEAD'
            ? { 'X-CSRF-Token': token }
            : {})
        }

        const res = await fetch(url, {
        credentials: 'include',
        ...options,
        headers
        })

        return res
    }, [])

    return csrfFetch
}