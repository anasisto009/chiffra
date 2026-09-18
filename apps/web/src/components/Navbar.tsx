import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  Upload as UploadIcon, 
  LayoutDashboard, 
  CheckSquare,
  FileSpreadsheet
} from 'lucide-react';
import { useMockAnomalies, useMockDocuments } from '../features/mvp/useMvpData';

export function Navbar() {
  const location = useLocation();
  const { data: anomalies = [] } = useMockAnomalies();
  const { data: documents = [] } = useMockDocuments();

  const pendingAnomaliesCount = anomalies.filter((a) => a.status === 'pending').length;

  const navItems = [
    { 
      path: '/upload', 
      label: 'Upload', 
      icon: UploadIcon,
      badge: documents.length > 0 ? documents.length : undefined
    },
    { 
      path: '/dashboard', 
      label: 'Dashboard', 
      icon: LayoutDashboard 
    },
    { 
      path: '/review', 
      label: 'Review', 
      icon: CheckSquare,
      badge: pendingAnomaliesCount > 0 ? pendingAnomaliesCount : undefined,
      badgeAlert: true
    },
    {
      path: '/export',
      label: 'Export TVA',
      icon: FileSpreadsheet
    }
  ];

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo */}
          <div className="flex items-center">
            <Link to="/dashboard" className="flex items-center space-x-3 group">
              <div className="bg-gradient-to-br from-primary-600 to-secondary-600 text-white px-4 py-2 rounded-xl font-bold text-lg shadow-lg group-hover:scale-105 transition-transform">
                Chiffra
              </div>
              <div className="hidden sm:block">
                <span className="text-xs text-gray-500 font-medium block">
                  Intelligence Comptable
                </span>
                <span className="text-[10px] text-secondary-600 font-semibold uppercase tracking-wider block">
                  Agentic Accounting
                </span>
              </div>
            </Link>
          </div>

          {/* Navigation */}
          <div className="flex items-center space-x-1 sm:space-x-2">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path || (item.path === '/dashboard' && location.pathname === '/');
              const Icon = item.icon;
              
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className="relative px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-200 group flex items-center"
                >
                  {isActive && (
                    <motion.div
                      layoutId="activeNav"
                      className="absolute inset-0 bg-primary-50 rounded-lg"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                  <div className={`relative flex items-center space-x-2 ${
                    isActive ? 'text-primary-700 font-semibold' : 'text-gray-600 hover:text-gray-900'
                  }`}>
                    <Icon className={`w-4 h-4 ${isActive ? 'text-primary-600' : 'text-gray-400 group-hover:text-gray-600'}`} />
                    <span className="hidden sm:inline">{item.label}</span>
                    {item.badge !== undefined && (
                      <span className={`ml-1 text-xs px-2 py-0.5 rounded-full font-bold ${
                        item.badgeAlert 
                          ? 'bg-warning/20 text-warning border border-warning/30' 
                          : isActive 
                            ? 'bg-primary-600 text-white' 
                            : 'bg-gray-100 text-gray-600'
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
