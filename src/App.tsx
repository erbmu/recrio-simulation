import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import SimulationSetup from "./pages/SimulationSetup";
import Index from "./pages/Index";
import Simulation from "./pages/Simulation";
import Analytics from "./pages/Analytics";
import NotFound from "./pages/NotFound";
import SimSession from "./pages/SimSession";
import IntroPage from "./pages/IntroPage";
import HonorLock from "./pages/HonorLock";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Landing / demo */}
          <Route path="/" element={<SimulationSetup />} />
          <Route path="/demo" element={<Index />} />

          {/* ✅ New flow */}
          <Route path="/sim/:token" element={<IntroPage />} />
          <Route path="/sim/:token/honor" element={<HonorLock />} />
          <Route path="/sim/:token/run" element={<SimSession />} />

          {/* Legacy/other views you already had */}
          <Route path="/simulation/:simulationId" element={<Simulation />} />
          <Route path="/analytics/:simulationId" element={<Analytics />} />
          <Route path="/s/:payload" element={<SimSession />} />

          {/* 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
