import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCheckSession } from '@/hooks/useCheckSession';
import { useTitle } from '@/hooks/useTitle';

export default function Home() {
  const Title = import.meta.env.VITE_NAME;
  useTitle(Title);

  const { authenticated, loading } = useCheckSession();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !authenticated) {
      navigate('login');
    }
    console.log('session loading:', loading, 'authenticated:', authenticated);
  }, [loading, authenticated, navigate]);

  return (
    <>
      <h1>🏠 Главная страница</h1>
    </>
  );
}
