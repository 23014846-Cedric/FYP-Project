// routes/notificationRouter.js
const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");


router.use((req, res, next) => {
  if (!req.user) return res.redirect("/login");
  next();
});
const getUserId = (req) => req.user?._id || req.user?.id;


// list notifications for current user role
router.get("/", async (req, res, next) => {
  try {
    if (!req.user) return res.redirect("/login");

    const category = String(req.query.category || "all");
    const severity = String(req.query.severity || "all");
    const read = String(req.query.read || "all"); // default unread

    const uid = getUserId(req);

    const visibilityOr = [
    { target_roles: req.user.role },
    { target_user_ids: uid },
    { recipient_user: uid }
    ];


    const findFilter = { $or: visibilityOr };

    // filters
    if (category !== "all") findFilter.category = category;
    if (severity !== "all") findFilter.severity = severity;
    if (read === "unread") findFilter.is_read = false;
    if (read === "read") findFilter.is_read = true;

    const notifications = await Notification.find(findFilter)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    res.render("notifications", {
      notifications,
      user: req.user,
      filters: { category, severity, read }
    });
  } catch (err) {
    next(err);
  }
});




// mark read
router.post("/:id/read", async (req, res) => {
  try {
    if (!req.user) return res.redirect("/login");

    await Notification.updateOne(
      {
        _id: req.params.id,
        $or: [
          { target_roles: req.user.role },
          { target_user_ids: getUserId(req) },
          { recipient_user: getUserId(req) }
        ]
      },
      { $set: { is_read: true } }
    );

    res.redirect("/notifications");
  } catch (err) {
    console.error(err);
    res.redirect("/notifications");
  }
});



// delete (admin can delete; if you want ops too, allow both)
router.post("/:id/delete", async (req, res) => {
  try {
    if (!req.user) return res.redirect("/login");

    await Notification.deleteOne({
      _id: req.params.id,
      $or: [
        { target_roles: req.user.role },
        { target_user_ids: getUserId(req) },
        { recipient_user: getUserId(req) }
      ]
    });

    res.redirect("/notifications");
  } catch (err) {
    console.error(err);
    res.redirect("/notifications");
  }
});


// get unread summary (count + latest) for badge
router.get("/unread/summary", async (req, res) => {
  try {
    if (!req.user) return res.json({ count: 0, latest: null });

    const role = req.user.role;

    const filter = {
      is_read: false,
      $or: [
        { target_roles: role },
        { target_user_ids: getUserId(req) },
        { recipient_user: getUserId(req) }
      ]
    };

    const latest = await Notification.findOne(filter).sort({ createdAt: -1 }).lean();
    const count = await Notification.countDocuments(filter);

    res.json({ count, latest });
  } catch (err) {
    console.error(err);
    res.json({ count: 0, latest: null });
  }
});


router.post("/read-all", async (req, res) => {
  try {
    const uid = req.user?._id || req.user?.id;
    if (!req.user) return res.redirect("/login");

    const visibilityOr = [
      { target_roles: req.user.role },
      { target_user_ids: uid },
      { recipient_user: uid }
    ];

    await Notification.updateMany(
      { $or: visibilityOr, is_read: false },
      { $set: { is_read: true } }
    );

    // ✅ send user back to notifications showing READ items so they can see the change
    return res.redirect("/notifications?read=read");
  } catch (err) {
    console.error("read-all error:", err);
    return res.redirect("/notifications");
  }
});



module.exports = router;
