const Notification = require("../models/Notification");

/**
 * Render notifications page
 */
exports.index = async (req, res) => {
  try {
    const notifications = await Notification.find({
      recipient_user: req.user._id
    })
      .sort({ createdAt: -1 })
      .lean();

    res.render("notifications", { notifications });
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to load notifications");
  }
};

/**
 * Get unread summary (count + latest)
 */
exports.unreadSummary = async (req, res) => {
  try {
    const userId = req.user._id;

    const latest = await Notification.findOne({
      recipient_user: userId,
      is_read: false
    })
      .sort({ createdAt: -1 })
      .lean();

    const count = await Notification.countDocuments({
      recipient_user: userId,
      is_read: false
    });

    res.json({ count, latest });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch unread notifications" });
  }
};

/**
 * Mark notification as read
 */
exports.markRead = async (req, res) => {
  try {
    await Notification.updateOne(
      { _id: req.params.id, recipient_user: req.user._id },
      { $set: { is_read: true } }
    );

    res.redirect("/notifications");
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to mark as read");
  }
};

/**
 * Delete notification
 */
exports.deleteOne = async (req, res) => {
  try {
    await Notification.deleteOne({
      _id: req.params.id,
      recipient_user: req.user._id
    });

    res.redirect("/notifications");
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to delete notification");
  }
};
