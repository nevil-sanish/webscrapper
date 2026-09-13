const express = require('express');
const router = express.Router();
const Hackathon = require('../models/Hackathon');

// GET /api/hackathons - Fetch all hackathons, sorted by startDate
router.get('/', async (req, res) => {
  try {
    const hackathons = await Hackathon.find().sort({ startDate: 1 });
    res.json(hackathons);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
