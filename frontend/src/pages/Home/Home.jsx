import { useTitle } from '@/hooks/useTitle'

export default function Home() {
    useTitle('Дом')
    return (
        <>
            <h1>🏠 Главная страница</h1>
        </>
    )
}