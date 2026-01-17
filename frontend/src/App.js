import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import AdminDashboard from './pages/AdminDashboard';
import SlotsGame from './pages/SlotsGame';
import CoinFlipLobby from './components/games/CoinFlipLobby';
import CoinFlipGame from './components/games/CoinFlipGame';
import PokerGame from './components/games/PokerGame';
import Roulette from './components/games/Roulette';
import Mines from './components/games/Mines';
import TowerGame from './components/games/TowerGame';
import Aviator from './components/games/Aviator';
import DiceGame from './components/games/DiceGame';
import UnoLobby from './components/games/UnoLobby';
import UnoGame from './components/games/UnoGame';
import Profile from './pages/Profile';
import Friends from './pages/Friends';
import Leaderboard from './pages/Leaderboard';
import { AuthProvider } from './context/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import AdminRoute from './components/AdminRoute';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: '#1a2c38',
            color: '#fff',
            border: '1px solid #00e701'
          }
        }}
      />
      <Router>
        <div className="App">
          <Navbar />
          <div className="main-content">
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route
                path="/dashboard"
                element={
                  <PrivateRoute>
                    <Dashboard />
                  </PrivateRoute>
                }
              />
              <Route
                path="/profile"
                element={
                  <PrivateRoute>
                    <Profile />
                  </PrivateRoute>
                }
              />
              <Route
                path="/games/slots"
                element={
                  <PrivateRoute>
                    <SlotsGame />
                  </PrivateRoute>
                }
              />
              <Route
                path="/games/coinflip"
                element={
                  <PrivateRoute>
                    <CoinFlipLobby />
                  </PrivateRoute>
                }
              />
              <Route
                path="/games/coinflip/:gameId"
                element={
                  <PrivateRoute>
                    <CoinFlipGame />
                  </PrivateRoute>
                }
              />
              <Route
                path="/games/poker"
                element={
                  <PrivateRoute>
                    <PokerGame />
                  </PrivateRoute>
                }
              />
              <Route
                path="/games/roulette"
                element={
                  <PrivateRoute>
                    <Roulette />
                  </PrivateRoute>
                }
              />
              <Route
                path="/games/mines"
                element={
                  <PrivateRoute>
                    <Mines />
                  </PrivateRoute>
                }
              />
              <Route
                path="/games/tower"
                element={
                  <PrivateRoute>
                    <TowerGame />
                  </PrivateRoute>
                }
              />
              <Route
                path="/games/aviator"
                element={
                  <PrivateRoute>
                    <Aviator />
                  </PrivateRoute>
                }
              />
              <Route
                path="/games/dice"
                element={
                  <PrivateRoute>
                    <DiceGame />
                  </PrivateRoute>
                }
              />
              <Route
                path="/games/uno"
                element={
                  <PrivateRoute>
                    <UnoLobby />
                  </PrivateRoute>
                }
              />
              <Route
                path="/games/uno/:roomId"
                element={
                  <PrivateRoute>
                    <UnoGame />
                  </PrivateRoute>
                }
              />
              <Route
                path="/friends"
                element={
                  <PrivateRoute>
                    <Friends />
                  </PrivateRoute>
                }
              />
              <Route
                path="/leaderboard"
                element={
                  <PrivateRoute>
                    <Leaderboard />
                  </PrivateRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <AdminRoute>
                    <AdminDashboard />
                  </AdminRoute>
                }
              />
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </div>
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
