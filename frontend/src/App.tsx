import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { ProductPage } from './pages/ProductPage';
import { PresentationPage } from './pages/PresentationPage';
import { DisplayPage } from './pages/DisplayPage';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/ciftis" replace />} />
        <Route path="/ciftis" element={<LandingPage />} />
        <Route path="/ciftis/display" element={<DisplayPage />} />
        <Route path="/ciftis/product/:slug" element={<ProductPage />} />
        <Route path="/ciftis/presentation/:slug" element={<PresentationPage />} />
        <Route path="*" element={<Navigate to="/ciftis" replace />} />
      </Routes>
    </BrowserRouter>
  );
};
