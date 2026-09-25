const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('app/index', { title: 'App' });
});

router.get('/login', (req, res) => {
  res.render('app/login', { title: 'Log in / Sign up' });
});

// Placeholder entity pages — flesh out once requirements are defined
router.get('/acronyms', (req, res) => {
  res.render('app/acronyms', { title: 'Acronyms' });
});

router.get('/collections', (req, res) => {
  res.render('app/collections', { title: 'Collections' });
});

router.routes = [
  { method: 'GET', path: '/', label: 'App index' },
  { method: 'GET', path: '/login', label: 'Log in / Sign up' },
  { method: 'GET', path: '/acronyms', label: 'Acronyms (placeholder)' },
  { method: 'GET', path: '/collections', label: 'Collections (placeholder)' },
];

module.exports = router;
