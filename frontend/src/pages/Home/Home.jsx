import { useEffect } from 'react'
import { useLocation, useNavigationType, useNavigate } from 'react-router-dom'
import { useTitle } from '@/hooks/useTitle'

export default function Home() {
    useTitle('Дом')

    const location = useLocation()
    const navigate = useNavigate()
    const navType = useNavigationType()

    useEffect(() => {
        const fromForce = location.state && location.state.forceScroll
        if (navType === 'PUSH' && fromForce) {
            const scrollY = window.scrollY || window.pageYOffset

            if (scrollY > 10) {
                window.scrollTo({ top: 0, behavior: 'smooth' })
            }
            navigate(location.pathname, { replace: true, state: {} })
        }
    }, [location, navType, navigate])

    return (
        <>
            <h1>🏠 Главная страница</h1>
        </>
    )
}
