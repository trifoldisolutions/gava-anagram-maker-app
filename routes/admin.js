const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('admin/index', { title: 'Admin' });
});

router.routes = [
  { method: 'GET', path: '/', label: 'Admin index' },
];

module.exports = router;
