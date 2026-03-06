import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sileo';
import 'sileo/styles.css';

// pages
import GalleryList from '@/pages/Gallery/GalleryList';
import GalleryView from '@/pages/Gallery/GalleryView';
import GalleryEdit from '@/pages/Gallery/GalleryEdit';

import Users from '@/pages/Admin/Users';
import Login from '@/pages/Login/Login';

import NotFound from '@/pages/404/404';
// components
import ScrollProgressBar from '@/components/ScrollProgressBar/ScrollProgressBar';
import Header from '@/components/Header/Header';
// hooks
import useHttpInterceptor from './hooks/useHttpInterceptor';
import { useScrollFix } from '@/hooks/useScrollFix';
import { sileoDefaultOptions } from '@/utils/notifications';

function AppInner() {
  useHttpInterceptor();

  useScrollFix();

  return (
    <>
      <ScrollProgressBar />
      <Header />
      <Toaster
        position="top-center"
        theme="dark"
        options={sileoDefaultOptions}
      />

      <Routes>
        <Route path="/" element={<GalleryList />} />
        <Route path="/edit" element={<GalleryEdit />} />
        <Route path="/edit/:year/:category" element={<GalleryEdit />} />
        <Route path="/edit/admin" element={<Users />} />
        <Route path="/:year/:category" element={<GalleryView />} />
        <Route path="/admin" element={<Users />} />
        <Route path="/login" element={<Login />} />
        <Route path="/auth" element={<Login />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
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
