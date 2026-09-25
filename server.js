require('dotenv').config();

const path = require('path');
const express = require('express');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3008;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Facades
const facades = [
  { name: 'Public', mount: '/', router: require('./routes/public') },
  { name: 'App', mount: '/app', router: require('./routes/app') },
  { name: 'Admin', mount: '/admin', router: require('./routes/admin') },
  { name: 'Dev', mount: '/dev-resources', router: require('./routes/tasks') },
];

facades.forEach(({ mount, router }) => app.use(mount, router));

// 404
app.use((req, res) => {
  res.status(404).render('public/404', { title: 'Not found' });
});

// Mongo
if (process.env.MONGO_URI) {
  mongoose
    .connect(process.env.MONGO_URI, { dbName: 'project_acronym_maker' })
    .then(() => console.log('MongoDB connected'))
    .catch((err) => console.error('MongoDB connection error:', err.message));
} else {
  console.warn('MONGO_URI is not set — database features are disabled.');
}

app.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log(`\nServer running at ${base}\n`);
  facades.forEach(({ name, mount, router }) => {
    console.log(`[${name}]`);
    (router.routes || []).forEach(({ method, path: p, label }) => {
      const full = (mount === '/' ? '' : mount) + (p === '/' && mount !== '/' ? '' : p);
      console.log(`  ${method.padEnd(6)} ${base}${full || '/'} — ${label}`);
    });
  });
  console.log('');
});
