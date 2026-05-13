import { updateRailwayReplicas } from '../lib/railway.js';

export default async function handler(req, res) {
  try {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      console.warn("Unauthorized cron request");
    }

    console.log("CRON STOP: Turning off Railway Service...");
    await updateRailwayReplicas(0);
    
    res.status(200).json({ success: true, message: 'Railway Service Stopped' });
  } catch (error) {
    console.error("CRON STOP ERROR:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}
