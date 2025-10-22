import { BrowserRouter, Routes, Route } from 'react-router-dom';
import useHttpInterceptor from './hooks/useHttpInterceptor';
// pages
import GalleryList from '@/pages/Gallery/GalleryList';
import GalleryView from '@/pages/Gallery/GalleryView';

import Users from '@/pages/Admin/Users';
import Login from '@/pages/Login/Login';

import NotFound from '@/pages/404/404';
// components
import Header from '@/components/Header/Header';
import Footer from '@/components/Footer/Footer';

function AppInner() {
  useHttpInterceptor();

  return (
    <>
      <Header />

      <Routes>
        <Route path="/" element={<GalleryList />} />
        <Route path="/edit" element={<GalleryList />} />
        <Route path="/:year/:category" element={<GalleryView />} />
        <Route path="/edit/:year/:category" element={<GalleryView />} />
        <Route path="/admin" element={<Users />} />
        <Route path="/login" element={<Login />} />
        <Route path="/auth" element={<Login />} />
        <Route path="*" element={<NotFound />} />
      </Routes>

      <Footer />
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  );
}

export default App;
