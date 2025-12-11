const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const CardDelivery = require('../models/CardDelivery');


// GET /exceptions

router.get('/', async (req, res) => {
    try {
        const exceptions = await CardDelivery.find({
        status: {
            $in: [
            'Pulled Out',
            'Not Found',
            'Returned to Printer',
            'Reprocessing'
            ]
        }
        })
        .sort({ expectedDate: 1 })   // sort by upcoming date
        .lean();

        res.render("exceptions", { 
            exceptions, 
            message: null,
            error: null 
        });

    } catch (err) {
        console.error("Error loading exceptions:", err);
        res.render("exceptions", { 
            exceptions: [], 
            message: null,
            error: "Failed to load exceptions." 
        });
    }
});


// GET /exceptions/:id/review
// Show Review/Edit Form

router.get('/:id/review', async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.redirect('/exceptions');
        }

        const delivery = await CardDelivery.findById(req.params.id).lean();
        if (!delivery) {
            return res.redirect('/exceptions');
        }

        res.render("reviewForm", { 
            delivery, 
            error: null 
        });

    } catch (err) {
        console.error("Error loading review page:", err);
        res.redirect('/exceptions');
    }
});


// Update delivery from Review Form

router.post('/:id/update', async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.redirect('/exceptions');
        }

        const updateData = {
            customer: req.body.customer?.trim(),
            vendor: req.body.vendor?.trim(),
            recipient: req.body.recipient?.trim(),
            address: req.body.address?.trim(),
            trackingNumber: req.body.trackingNumber?.trim(),
            status: req.body.status,

            // Convert date safely
            expectedDate: req.body.expectedDate 
                ? new Date(req.body.expectedDate)
                : undefined,

            notes: req.body.notes || ""
        };

        await CardDelivery.findByIdAndUpdate(req.params.id, updateData, {
            runValidators: true
        });

        res.redirect('/exceptions');

    } catch (err) {
        console.error("Update error:", err);

        // Reload form with error message
        const delivery = await CardDelivery.findById(req.params.id).lean();
        res.render("reviewForm", { 
            delivery, 
            error: "Failed to update delivery. Please check your inputs." 
        });
    }
});

module.exports = router;

