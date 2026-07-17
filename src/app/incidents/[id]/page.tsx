import { notFound } from "next/navigation";
import { IncidentHero } from "@/components/incident/incident-hero";
import { StaticIncidentDetail } from "@/components/incident/static-incident-detail";
import { incidents, PRIMARY_INCIDENT_ID } from "@/lib/mock-data";

export function generateStaticParams() {
  return incidents.map((i) => ({ id: i.id }));
}

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const incident = incidents.find((i) => i.id === id);
  if (!incident) notFound();

  if (incident.id === PRIMARY_INCIDENT_ID) {
    return <IncidentHero incident={incident} />;
  }
  return <StaticIncidentDetail incident={incident} />;
}
