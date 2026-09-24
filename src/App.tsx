import { lazy, Suspense, useEffect } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { isFirebaseConfigured } from "./config/firebase";
import { UIProvider } from "./store/ui";
import { DataProvider, useData } from "./store/data";
import { Layout } from "./components/Layout";
import { watchSystemTheme } from "./lib/theme";
import SignIn from "./pages/SignIn";
import { AccessDenied, NotConfigured } from "./pages/Setup";
import Dashboard from "./pages/Dashboard";

const PeriodBudget = lazy(() => import("./pages/PeriodBudget"));
const Annual = lazy(() => import("./pages/Annual"));
const Wishlist = lazy(() => import("./pages/Wishlist"));
const Planning = lazy(() => import("./pages/Planning"));
const Settings = lazy(() => import("./pages/Settings"));

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-label="Loading" role="status">
      <div className="h-8 w-48 rounded-lg bg-surface-2" />
      <div className="h-28 rounded-2xl bg-surface-2" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl bg-surface-2" />)}
      </div>
      <div className="h-64 rounded-2xl bg-surface-2" />
    </div>
  );
}

function Gate() {
  const { authReady, user, loaded, denied } = useData();
  if (!authReady) return <div className="p-6"><Skeleton /></div>;
  if (!user) return <SignIn />;
  if (denied) return <AccessDenied uid={user.uid} email={user.email} />;
  return (
    <Layout>
      {!loaded ? (
        <Skeleton />
      ) : (
        <Suspense fallback={<Skeleton />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/budget" element={<PeriodBudget />} />
            <Route path="/budget/:periodId" element={<PeriodBudget />} />
            <Route path="/annual" element={<Annual />} />
            <Route path="/wishlist" element={<Wishlist />} />
            <Route path="/planning" element={<Planning />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      )}
    </Layout>
  );
}

export default function App() {
  useEffect(() => watchSystemTheme(), []);
  if (!isFirebaseConfigured) return <NotConfigured />;
  return (
    <HashRouter>
      <UIProvider>
        <DataProvider>
          <Gate />
        </DataProvider>
      </UIProvider>
    </HashRouter>
  );
}
