const mongoose = require('mongoose');

const asteroidSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    neoId: {
        type: String,
        default: null
    },
    potentiallyHazardous: {
        type: Boolean,
        required: true
    },
    estimatedDiameter: {
        type: Number,
        default: null
    },
    estimatedDiameterMin: {
        type: Number,
        default: null
    },
    absoluteMagnitudeH: {
        type: Number,
        default: null
    },
    nasaJplUrl: {
        type: String,
        default: null
    },
    closeApproachDate: {
        type: String,
        default: null
    },
    missDistanceKm: {
        type: Number,
        default: null
    },
    relativeVelocityKps: {
        type: Number,
        default: null
    },
    isSentryObject: {
        type: Boolean,
        default: false
    },
    note: {
        type: String,
        default: ""
    },
    userId: { type: String, required: true }
});

asteroidSchema.index({ userId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Asteroid', asteroidSchema);
