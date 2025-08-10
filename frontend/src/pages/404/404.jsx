import { Link } from 'react-router-dom';
import { useTitle } from '@/hooks/useTitle';
import { Frown } from 'lucide-react';
// import styles from './404.module.css'

export default function NotFound() {
  useTitle('Не найдено - 404');
  return (
    <>
      <h1>404</h1>
      <h2>
        Мы не нашли страничку по вашему запросу <Frown />
      </h2>
      <h3>
        Вернуться на <Link to="/">Главная</Link>
      </h3>
    </>
  );
}
