import { PageHeader } from "@/components/page-header";
import { IncidentCard } from "@/components/incidents/incident-card";
import { Pill } from "@/components/ui/chip";
import { incidents } from "@/lib/mock-data";

export default function IncidentsPage() {
  const active = incidents.filter((i) => i.status !== "resolved").length;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <PageHeader
        title="Incidents"
        subtitle="Every incident is worked by the agent on live data. No human is paged unless the gate refuses to escalate."
        action={
          <Pill tone="signal">
            {active} active · {incidents.length} total
          </Pill>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {incidents.map((incident) => (
          <IncidentCard key={incident.id} incident={incident} />
        ))}
      </div>
    </div>
  );
}
