import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Navbar } from './components/Navbar';
import { Dashboard } from './pages/Dashboard';
import { UploadPage } from './pages/UploadPage';
import { ReviewPage } from './pages/ReviewPage';
import { ExportPage } from './pages/ExportPage';
import './styles.css';

export function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50 text-gray-900 antialiased flex flex-col selection:bg-primary-100 selection:text-primary-900">
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3500,
            style: {
              background: '#111827',
              color: '#ffffff',
              borderRadius: '14px',
              padding: '12px 18px',
              fontSize: '13px',
              fontWeight: 600,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
            },
            success: {
              iconTheme: {
                primary: '#10b981',
                secondary: '#ffffff'
              }
            },
            error: {
              iconTheme: {
                primary: '#ef4444',
                secondary: '#ffffff'
              }
            }
          }}
        />

        <Navbar />

        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/export" element={<ExportPage />} />
          </Routes>
        </main>

        {/* Pied de page professionnel */}
        <footer className="border-t border-gray-200 bg-white/80 backdrop-blur-sm py-6 text-xs text-gray-500">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              <div className="bg-gradient-to-br from-primary-600 to-secondary-600 text-white px-2.5 py-1 rounded-lg font-bold text-xs">
                Chiffra
              </div>
              <span className="font-semibold text-gray-700">
                Plateforme d'Ingestion & Rapprochement Comptable Multi-Formats
              </span>
            </div>

            <div className="flex items-center space-x-4 text-xs">
              <span className="inline-flex items-center gap-1.5 text-gray-600">
                <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                PostgreSQL & Redis BullMQ Actifs
              </span>
              <span>•</span>
              <span className="text-gray-500">Conforme Code Général des Impôts (CGI Maroc)</span>
            </div>
          </div>
        </footer>
      </div>
    </Router>
  );
}

export default App;
