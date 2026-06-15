import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Flow from './pages/Flow';
import Timeline from './pages/Timeline';
import Categories from './pages/Categories';
import Anomalies from './pages/Anomalies';
import Budgets from './pages/Budgets';
import Assistant from './pages/Assistant';
import Connect from './pages/Connect';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/flow" element={<Flow />} />
        <Route path="/timeline" element={<Timeline />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/anomalies" element={<Anomalies />} />
        <Route path="/budgets" element={<Budgets />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/connect" element={<Connect />} />
      </Routes>
    </Layout>
  );
}
