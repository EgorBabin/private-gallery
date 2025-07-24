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

      <p>
        Lorem ipsum dolor sit amet, consectetur adipisicing elit. Fugiat fuga sapiente esse consectetur. Quia, necessitatibus. Culpa fugiat corrupti doloribus, rem voluptate distinctio ab necessitatibus omnis, assumenda deleniti perspiciatis, atque dolores?
        Lorem ipsum dolor sit amet consectetur adipisicing elit. Aperiam reprehenderit impedit laboriosam unde fugiat exercitationem tempore consequatur accusamus libero ad maxime quidem, asperiores labore itaque nihil deserunt quibusdam minima nulla.
        Lorem ipsum dolor sit, amet consectetur adipisicing elit. Corporis repudiandae laudantium quod delectus. Ea cum ex fugit praesentium nemo. Doloribus, unde. Mollitia aliquam nesciunt magnam libero aspernatur! Exercitationem, laboriosam repellat?
        Lorem ipsum dolor sit amet, consectetur adipisicing elit. Suscipit minima ad placeat laudantium voluptatum possimus, maxime ut non nihil, voluptas facere deserunt. Repellat possimus omnis molestiae praesentium eos odit optio?
        Lorem, ipsum dolor sit amet consectetur adipisicing elit. Doloremque vero aliquid deleniti quas quibusdam in, animi, provident, dolor eveniet quis vitae facere asperiores iste fuga ratione illum! Modi, tempore perferendis.
        Lorem ipsum dolor sit amet, consectetur adipisicing elit. Rem dolore rerum porro aliquid cumque ducimus vero laudantium suscipit ullam, labore saepe id delectus iure officia, veritatis est libero enim odio!
        Lorem ipsum, dolor sit amet consectetur adipisicing elit. Culpa magni quia veniam labore voluptatibus soluta voluptatum eaque deserunt aliquid, debitis repudiandae quisquam molestiae mollitia optio nisi, accusantium pariatur sit quo.
        Lorem ipsum dolor sit amet consectetur adipisicing elit. Vel perferendis architecto molestias fuga sapiente amet quo rem velit libero cupiditate id doloremque deserunt ipsum sed consequuntur, voluptatum consectetur et praesentium?
        Lorem ipsum dolor sit amet consectetur, adipisicing elit. Et consequatur modi consequuntur corrupti dolor deserunt sequi provident corporis? Reprehenderit dolorem illum alias quasi est voluptas inventore tempora neque enim natus.
        Lorem ipsum dolor sit amet consectetur adipisicing elit. Sunt, vel tempore nostrum quas temporibus ea tempora eveniet adipisci voluptates reiciendis atque officiis mollitia quae dolore, sequi magnam nisi illo labore?
        Lorem ipsum, dolor sit amet consectetur adipisicing elit. Magnam, enim repellendus. Aperiam rem sed in atque veniam eum fuga eius nihil ea, voluptatem quae obcaecati adipisci velit eveniet aliquid porro?
      </p>

      <Footer />

    </BrowserRouter>
  )
}

export default App
