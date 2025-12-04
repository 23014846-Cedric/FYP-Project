const router = require('express').Router();
const userController = require('../controllers/userController');
const authMiddleware = require("../middleware/authMiddleware");

router.post('/signin', userController.signin);
router.get('/logout', userController.logout);
router.get('/signup', userController.showSignupForm);
router.post('/signup', userController.signup);
router.post("/updateRole", authMiddleware, userController.updateUserRole);


module.exports = router;