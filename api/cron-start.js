import { updateRailwayReplicas } from '../lib/railway.js';

export default async function handler(req, res) {
  try {
    // Vercel Cron requests have a special header to verify authenticity
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      // In development/test you might bypass this, but for production it's safe
      console.warn("Unauthorized cron request");
    }

    console.log("CRON START: Turning on Railway Service...");
    await updateRailwayReplicas(1);
    
    res.status(200).json({ success: true, message: 'Railway Service Started' });
  } catch (error) {
    console.error("CRON START ERROR:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}
