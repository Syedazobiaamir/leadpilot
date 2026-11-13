// Operational report (Stage 8). Staff only.
import { buildOverview } from '../services/reportService.js'

export async function getOverview(req, res) {
  res.json({ data: await buildOverview() })
}
