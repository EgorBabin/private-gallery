import { Link } from 'react-router-dom'
import { useTitle } from '@/hooks/useTitle'
// import styles from './404.module.css'

export default function NotFound() {
    useTitle('Не найдено - 404')
    return (
        <>
            <h1>404 - не найдено</h1>
            <h2>Вернуться на <Link to="/">Главная</Link></h2>
        </>
    )
}