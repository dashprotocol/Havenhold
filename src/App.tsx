import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import AppLayout from "./components/AppLayout";
import LoginPage from "./pages/LoginPage";
import FeedPage from "./pages/FeedPage";
import AppointmentsPage from "./pages/AppointmentsPage";
import MedicationsPage from "./pages/MedicationsPage";
import DocumentsPage from "./pages/DocumentsPage";
import DocumentUploadPage from "./pages/DocumentUploadPage";
import DocumentDetailPage from "./pages/DocumentDetailPage";
import AddAppointmentPage from "./pages/AddAppointmentPage";
import FamilyPage from "./pages/FamilyPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <Routes>
                    <Route path="/" element={<FeedPage />} />
                    <Route path="/appointments" element={<AppointmentsPage />} />
                    <Route path="/appointments/add" element={<AddAppointmentPage />} />
                    <Route path="/medications" element={<MedicationsPage />} />
                    <Route path="/documents" element={<DocumentsPage />} />
                    <Route path="/documents/upload" element={<DocumentUploadPage />} />
                    <Route path="/documents/:id" element={<DocumentDetailPage />} />
                    <Route path="/family" element={<FamilyPage />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </AppLayout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
