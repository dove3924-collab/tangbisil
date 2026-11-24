import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { initAnalytics, trackPage } from './lib/analytics'
import BossKey from './components/BossKey'
import Lobby from './pages/Lobby'
import Room from './pages/Room'
import EscapeGame from './escape/EscapeGame'
import EscapeResult from './escape/EscapeResult'
import WorkshopGame from './workshop/WorkshopGame'
import WorkshopResult from './workshop/WorkshopResult'
import WordballGame from './wordball/WordballGame'
import MinesGame from './mines/MinesGame'
import SudokuGame from './sudoku/SudokuGame'
import ShapesGame from './shapes/ShapesGame'
import CableGame from './cable/CableGame'
import FramedGame from './framed/FramedGame'
import FramedResult from './framed/FramedResult'
import StatusPage from './status/StatusPage'

initAnalytics()

/** 화면이 바뀔 때마다 GA 페이지뷰 */
function PageViews() {
  const { pathname } = useLocation()
  useEffect(() => { trackPage(pathname) }, [pathname])
  return null
}

export default function App() {
  return (
    <BossKey>
      <BrowserRouter>
        <PageViews />
        <Routes>
          <Route path="/" element={<Lobby />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/r/:code" element={<Room />} />
          <Route path="/escape" element={<EscapeGame />} />
          <Route path="/escape/result" element={<EscapeResult />} />
          <Route path="/workshop" element={<WorkshopGame />} />
          <Route path="/workshop/result" element={<WorkshopResult />} />
          <Route path="/wordball" element={<WordballGame />} />
          <Route path="/mines" element={<MinesGame />} />
          <Route path="/sudoku" element={<SudokuGame />} />
          <Route path="/shapes" element={<ShapesGame />} />
          <Route path="/cable" element={<CableGame />} />
          <Route path="/framed" element={<FramedGame />} />
          <Route path="/framed/result" element={<FramedResult />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </BossKey>
  )
}
