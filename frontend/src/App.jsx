import {
  BrowserRouter,
  Routes,
  Route,
  useLocation,
  matchPath,
} from 'react-router-dom';
import useHttpInterceptor from './hooks/useHttpInterceptor';

import ColorBends from '@/components/ColorBends/ColorBends';
// pages
import GalleryList from '@/pages/Gallery/GalleryList';
import GalleryView from '@/pages/Gallery/GalleryView';
import GalleryEdit from '@/pages/Gallery/GalleryEdit';

import Users from '@/pages/Admin/Users';
import Login from '@/pages/Login/Login';
import Passkey from '@/pages/Login/Passkey';

import NotFound from '@/pages/404/404';
// components
import Header from '@/components/Header/Header';

function AppInner() {
  useHttpInterceptor();

  const location = useLocation();
  const hideBackground = matchPath('/:year/:category', location.pathname);

  return (
    <>
      {!hideBackground && (
        <div className="color-bends-container">
          <ColorBends
            rotation={0}
            speed={0.2}
            scale={1}
            frequency={1}
            warpStrength={1}
            mouseInfluence={0}
            parallax={0}
            noise={0}
            transparent
          />
        </div>
      )}

      <Header />

      <Routes>
        <Route path="/" element={<GalleryList />} />
        <Route path="/edit" element={<GalleryList />} />
        <Route path="/:year/:category" element={<GalleryView />} />
        <Route path="/edit/:year/:category" element={<GalleryEdit />} />
        <Route path="/admin" element={<Users />} />
        <Route path="/login" element={<Login />} />
        <Route path="/auth" element={<Login />} />
        <Route path="/passkey" element={<Passkey />} />
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
