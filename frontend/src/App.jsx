import {
  BrowserRouter,
  Routes,
  Route,
  useLocation,
  matchPath,
} from 'react-router-dom';

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
import ColorBends from '@/components/ColorBends/ColorBends';
import { useScrollFix } from '@/hooks/useScrollFix';

function AppInner() {
  useHttpInterceptor();

  useScrollFix();

  const location = useLocation();
  const hideBackground = matchPath('/:year/:category', location.pathname);

  return (
    <>
      {!hideBackground && (
        <div className="color-bends-container">
          <ColorBends />
        </div>
      )}

      <ScrollProgressBar />
      <Header />

      <Routes>
        <Route path="/" element={<GalleryList />} />
        <Route path="/edit" element={<GalleryList />} />
        <Route path="/:year/:category" element={<GalleryView />} />
        <Route path="/edit/:year/:category" element={<GalleryEdit />} />
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
