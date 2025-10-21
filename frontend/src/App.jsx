import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import useHttpInterceptor from './hooks/useHttpInterceptor';
// pages
import GalleryList from '@/pages/Gallery/GalleryList';
import GalleryView from '@/pages/Gallery/GalleryView';
// import GalleryEdit from "@/pages/Gallery/GalleryEdit";

import Users from '@/pages/Admin/Users';
import Login from '@/pages/Login/Login';

import NotFound from '@/pages/404/404';
// components
import Header from '@/components/Header/Header';
import Footer from '@/components/Footer/Footer';

function AppInner() {
  useHttpInterceptor();

  // const location = useLocation();
  // const isEditMode = new URLSearchParams(location.search).has('edit');

  return (
    <>
      <Header />

      <Routes>
        <Route path="/" element={<GalleryList />} />
        <Route path="/:year/:category" element={<GalleryView />} />
        {/* <Route
          path="/*"
          element={isEditMode ? <EditPage /> : <GalleryPage />}
        /> */}
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
