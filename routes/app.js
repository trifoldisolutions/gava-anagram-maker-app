const express = require('express');

const router = express.Router();

// The single-page brainstorm tool; session id travels in ?s=<id>
router.get('/', (req, res) => {
  res.render('app/index', { title: 'Acronym Maker — App', wide: true });
});

router.routes = [
  { method: 'GET', path: '/', label: 'Acronym brainstorm tool' },
];

module.exports = router;
