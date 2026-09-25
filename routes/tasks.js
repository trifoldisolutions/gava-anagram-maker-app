const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const Task = require('../models/Task');

const router = express.Router();
const VIEW = path.join(__dirname, '..', 'dev_resources', 'tasks.ejs');
const STATUSES = ['todo', 'in-progress', 'done'];

const dbReady = () => mongoose.connection.readyState === 1;

router.get('/tasks', async (req, res, next) => {
  try {
    const tasks = dbReady() ? await Task.find().sort({ createdAt: -1 }) : [];
    res.render(VIEW, { tasks, statuses: STATUSES, dbReady: dbReady() });
  } catch (err) {
    next(err);
  }
});

router.post('/tasks', async (req, res, next) => {
  try {
    const { title, description, status } = req.body;
    if (dbReady() && title) await Task.create({ title, description, status });
    res.redirect('/dev-resources/tasks');
  } catch (err) {
    next(err);
  }
});

router.post('/tasks/:id', async (req, res, next) => {
  try {
    const { title, description, status } = req.body;
    if (dbReady()) {
      await Task.findByIdAndUpdate(req.params.id, { title, description, status }, { runValidators: true });
    }
    res.redirect('/dev-resources/tasks');
  } catch (err) {
    next(err);
  }
});

router.post('/tasks/:id/delete', async (req, res, next) => {
  try {
    if (dbReady()) await Task.findByIdAndDelete(req.params.id);
    res.redirect('/dev-resources/tasks');
  } catch (err) {
    next(err);
  }
});

router.routes = [
  { method: 'GET', path: '/tasks', label: 'Internal task board' },
];

module.exports = router;
