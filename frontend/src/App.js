import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import AdminDashboard from './pages/AdminDashboard';
import SlotsGame from './pages/SlotsGame';
import CoinFlipLobby from './components/games/CoinFlipLobby';
import CoinFlipGame from './components/games/CoinFlipGame';
import PokerGame from './components/games/PokerGame';
import Roulette from './components/games/Roulette';
import Mines from './components/games/Mines';
import Profile from './pages/Profile';
import { AuthProvider } from './context/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import AdminRoute from './components/AdminRoute';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="App">
          <Navbar />
          <div className="main-content">
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
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
