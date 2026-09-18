import { AlertTriangle, Banknote, Clock3 } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { formatMad, formatPercentage } from "../../lib/formatters";
import { useMockMetrics } from "../mvp/useMvpData";

export function MvpDashboard() {
  const { data: metrics } = useMockMetrics();

  if (!metrics) return <div className="p-8 text-slate-600">Chargement des métriques...</div>;

  const matchRate = (metrics.matchedDocuments / metrics.totalDocuments) * 100;
  const maxFamilyCount = Math.max(...metrics.anomalyFamilies.map((family) => family.count));

  return (
    <section className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">EX-03 · EX-04</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Dashboard honnête</h1>
        <p className="mt-2 max-w-2xl text-slate-600">Les chiffres distinguent les documents rapprochés, ceux à traiter et l'exposition réellement identifiée.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Taux de rapprochement réel" value={formatPercentage(matchRate)} detail={`${metrics.matchedDocuments} rapprochés sur ${metrics.totalDocuments}`} icon={<Banknote className="h-5 w-5" />} />
        <MetricCard label="Exposition financière totale" value={formatMad(metrics.totalExposureMad)} detail="Anomalies actuellement ouvertes" icon={<AlertTriangle className="h-5 w-5" />} />
        <MetricCard label="Documents en attente humaine" value={String(metrics.humanQueue)} detail="Non traités ou à confirmer" icon={<Clock3 className="h-5 w-5" />} />
      </div>

      <Card>
        <CardHeader><CardTitle>Rapprochement bancaire</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 text-sm"><Badge variant="success">{formatPercentage(matchRate)} rapprochés</Badge><Badge variant="warning">{formatPercentage(100 - matchRate)} à traiter</Badge></div>
          <div className="mt-4 h-4 overflow-hidden rounded-full bg-amber-100"><div className="h-full bg-emerald-500" style={{ width: `${matchRate}%` }} /></div>
          <p className="mt-3 text-sm text-slate-600">Le taux n'inclut pas les documents non traités comme s'ils étaient rapprochés.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Répartition des familles d'anomalies</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {metrics.anomalyFamilies.map((family) => (
            <div key={family.label} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-sm">
              <span className="font-medium text-slate-700">{family.label}</span>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${(family.count / maxFamilyCount) * 100}%` }} /></div>
              <strong className="w-8 text-right text-slate-900">{family.count}</strong>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

type MetricCardProps = { label: string; value: string; detail: string; icon: ReactNode };

function MetricCard({ label, value, detail, icon }: MetricCardProps) {
  return <Card><CardContent className="p-5"><div className="flex items-center justify-between text-blue-600">{icon}<span className="text-xs font-semibold uppercase tracking-wide text-slate-500">MVP</span></div><p className="mt-5 text-sm text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-950">{value}</p><p className="mt-2 text-sm text-slate-600">{detail}</p></CardContent></Card>;
}
