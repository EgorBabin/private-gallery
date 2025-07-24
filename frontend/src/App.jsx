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
      <p>Lorem ipsum dolor sit amet, consectetur adipisicing elit. Est quidem ut, atque iste velit qui placeat obcaecati possimus ullam nostrum harum unde consequuntur laboriosam modi repellat beatae. Sunt, debitis architecto.
        Lorem ipsum, dolor sit amet consectetur adipisicing elit. Nam placeat natus aut ad eaque, facilis minus. Veniam voluptatem numquam ipsa autem, dolore dolorum, quod odit voluptatum, debitis temporibus quasi laboriosam.
        Lorem, ipsum dolor sit amet consectetur adipisicing elit. Quidem, ex enim odit quam, porro voluptate vel nulla accusamus deleniti veritatis perspiciatis nisi minus libero voluptas vitae. Eius ea deserunt a.
        Lorem ipsum dolor sit amet consectetur adipisicing elit. Commodi a reiciendis veritatis consequatur veniam? Placeat reiciendis in iste rerum natus error, excepturi velit doloribus commodi accusantium corrupti sint quae nisi.
        Lorem ipsum dolor sit amet consectetur adipisicing elit. Facere exercitationem sed, aliquam repellendus, doloremque maxime eveniet, quo cum laudantium cumque ut. Porro aut quasi consequuntur, exercitationem laudantium corrupti delectus deserunt.
        Lorem ipsum dolor sit amet consectetur adipisicing elit. Totam maxime minus aut iste voluptatibus dolore sequi quam. Veritatis voluptate labore doloribus ullam dicta illo impedit at, suscipit excepturi amet dolores!
        Lorem ipsum dolor sit amet consectetur, adipisicing elit. Accusantium nisi amet minus voluptatem optio esse rem! Maxime quos laborum blanditiis culpa, fugit minima cupiditate, at obcaecati eum nobis sed itaque?
        Lorem ipsum dolor sit amet consectetur adipisicing elit. Eligendi vel praesentium perferendis natus culpa at voluptate. Ut debitis molestiae sapiente aspernatur, incidunt officia impedit? Voluptatibus vitae perspiciatis consequuntur cumque temporibus.
      </p>
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
