const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('public/index');
});

router.get('/about', (req, res) => {
  res.render('public/about', { title: 'About' });
});

router.routes = [
  { method: 'GET', path: '/', label: 'Landing page' },
  { method: 'GET', path: '/about', label: 'About page' },
];

module.exports = router;
