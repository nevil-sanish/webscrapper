const mongoose = require('mongoose');

const hackathonSchema = new mongoose.Schema({
  name: { type: String, required: true },
  source: { 
    type: String, 
    enum: ['devpost', 'devfolio', 'unstop', 'hackerearth', 'search'],
    required: true 
  },
  sourceUrl: { type: String, required: true },
  startDate: { type: Date },
  endDate: { type: Date },
  registrationDeadline: { type: Date },
  location: { type: String }, // 'Online' | city name
  organizer: { type: String },
  prize: { type: String },
  eligibility: { type: String }, // e.g. 'students', 'open'
  tags: [{ type: String }],
  description: { type: String },
  firstSeenAt: { type: Date, default: Date.now },
  lastUpdatedAt: { type: Date, default: Date.now },
  isKeralaRelevant: { type: Boolean, default: false }
});

// Unique index on a normalized composite key to support upserts during dedup.
// Note: We'll use a pre-save hook or handle this in the dedup logic to ensure lowercased name.
// For the database level, we can ensure uniqueness based on sourceUrl as a strong identifier, 
// but the plan says "lower cased name + startDate". Let's create a compound index.
hackathonSchema.index({ name: 1, startDate: 1 }, { unique: true });

module.exports = mongoose.model('Hackathon', hackathonSchema);
