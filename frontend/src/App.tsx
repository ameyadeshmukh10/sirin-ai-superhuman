import { Route, Routes } from "react-router-dom";
import EmbedPage from "./pages/EmbedPage";
import Landing from "./pages/Landing";
import SessionPage from "./pages/SessionPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/session/:sessionId" element={<SessionPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/embed" element={<EmbedPage />} />
    </Routes>
  );
}
