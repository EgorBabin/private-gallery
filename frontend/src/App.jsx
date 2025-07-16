import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
// pages
import Home from '@/pages/Home/Home'
import Users from '@/pages/Admin/Users'
import Login from '@/pages/Login/Login'
import NotFound from '@/pages/404/404'
// components
import Header from '@/components/Header/Header'
import Footer from '@/components/Footer/Footer'


function App() {
  return (
    <BrowserRouter>

      <Header />

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/users" element={<Users />} />
        <Route path="/login" element={<Login />} />
        <Route path="/auth" element={<Login />} />
        <Route path="*" element={<NotFound />} />
      </Routes>

      <Footer />

    </BrowserRouter>
  )
}

export default App
