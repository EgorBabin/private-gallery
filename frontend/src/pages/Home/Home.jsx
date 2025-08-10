import { useTitle } from '@/hooks/useTitle';

export default function Home() {
  const Title = import.meta.env.VITE_NAME;
  useTitle(Title);
  return (
    <>
      <h1>🏠 Главная страница</h1>
    </>
  );
}
