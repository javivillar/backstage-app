import { componentRows, interconnectionAttention, interconnectionZones, segregations, siteRole } from '../interconnection';
import { type InfraView, useVmRequests, useZone } from '../zone';

/** The interconnection of this site from the zone view of the host and the VM files of the console. */
export function useInterconnection() {
  const zone = useZone();
  const vms = useVmRequests();
  const view = zone.data as InfraView | undefined;
  const segs = view ? segregations(view) : [];
  const rows = componentRows(view, vms.data?.vms ?? [], vms.data?.policy);
  const zones = interconnectionZones(segs, rows);
  return { zone, vms, view, role: siteRole(view), segs, rows, zones, attention: interconnectionAttention(zones) };
}
